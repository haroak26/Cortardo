import type { ReviewResult } from "../../../cortardobot/src/v3/types.ts";
import { locateEdit } from "../../../cortardobot/src/v3/patch.ts";
import {
  createCheckRun,
  createPullRequestReview,
  updateCheckRun,
  type CreateCheckRunInput,
  type PullRequestReviewInput,
} from "../github/api";

export interface PublishInput {
  installationId: string | number;
  fullName: string;
  prNumber: number;
  headSha: string;
  result: ReviewResult;
  checkRunId?: number;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function shortClaim(claim: string, max = 160): string {
  return claim.length <= max ? claim : `${claim.slice(0, max - 1)}…`;
}

interface Suggestion {
  startLine: number;
  endLine: number;
  replace: string;
}

function suggestionFor(finding: ReviewResult["findings"][number], result: ReviewResult): Suggestion | undefined {
  const repair = finding.repair;
  if (!repair || repair.exit !== "VERIFIED" || !repair.finalEdits || repair.finalEdits.length === 0) return undefined;
  const file = finding.candidate.file;
  if (!file) return undefined;
  const edit = repair.finalEdits.find((entry) => entry.path === file);
  if (!edit) return undefined;
  const parsed = result.context?.files.find((entry) => entry.path === file);
  if (!parsed?.content) return undefined;
  const location = locateEdit(parsed.content, edit);
  if (!location) return undefined;
  return { startLine: location.startLine, endLine: location.endLine, replace: edit.replace };
}

function lineInDiff(result: ReviewResult, file: string, line: number): boolean {
  const parsed = result.context?.files.find((entry) => entry.path === file);
  if (!parsed) return false;
  for (const hunk of parsed.hunks) {
    for (const diffLine of hunk.lines) {
      if (diffLine.newLine === line && diffLine.type !== "-") return true;
    }
  }
  return false;
}

function findingStatus(finding: ReviewResult["findings"][number]): string {
  const verified = finding.repair?.exit === "VERIFIED" && finding.verification?.passed;
  if (verified) return "fixed and verified";
  if (finding.repair?.exit === "VERIFIED") return "fixed (verification pending)";
  if (finding.repair?.exit === "UNSAFE") return "fix rejected as unsafe";
  if (finding.repair?.exit === "BUDGET_EXHAUSTED") return "repair budget exhausted";
  if (finding.repair) return "reproduced, fix unresolved";
  return "reproduced";
}

export function buildReviewBody(result: ReviewResult): string {
  const lines: string[] = [];
  lines.push("## Cortado Review");
  lines.push("");
  const { summary } = result;
  lines.push(
    `${summary.issuesFound} issue(s) found · **${summary.issuesConfirmed} confirmed** · **${summary.issuesFixed} fixed** · **${summary.issuesVerified} verified and passing**`,
  );
  lines.push("");
  lines.push(
    `_${result.pr.classification.join(" / ")} · ${result.pr.size} change · ${(summary.durationMs / 1000).toFixed(1)}s · ${summary.modelCalls} model calls · $${summary.costUsd.toFixed(4)}_`,
  );
  lines.push("");

  if (result.findings.length > 0) {
    lines.push("| Severity | Finding | Location | Status |");
    lines.push("| --- | --- | --- | --- |");
    for (const finding of result.findings) {
      lines.push(
        `| ${finding.candidate.severity.toUpperCase()} | ${shortClaim(finding.candidate.claim)} | \`${finding.candidate.file ?? ""}:${finding.candidate.line ?? ""}\` | ${findingStatus(finding)} |`,
      );
    }
    lines.push("");
  }

  for (const finding of result.findings) {
    const status = findingStatus(finding);
    lines.push("<details>");
    lines.push(`<summary><strong>${finding.candidate.severity.toUpperCase()}</strong> — ${shortClaim(finding.candidate.claim, 110)} (${status})</summary>`);
    lines.push("");
    lines.push(`**What:** ${finding.candidate.claim}`);
    lines.push(`**Where:** \`${finding.candidate.file}:${finding.candidate.line}\``);
    lines.push(`**Evidence:** ${finding.candidate.evidence.join(", ")}`);
    lines.push(`**Reproduction (${finding.proof.strategy}):**`);
    lines.push("```");
    lines.push(finding.proof.reproduction.slice(0, 1500));
    lines.push("```");
    if (finding.repair) {
      const attempts = finding.repair.attempts
        .map((attempt) => `attempt ${attempt.attempt}: ${attempt.applied ? "applied" : "not applied"} — ${attempt.strategy}`)
        .join("\n");
      lines.push(`**Repair:** ${finding.repair.exit} — ${finding.repair.reason}`);
      lines.push("```");
      lines.push(finding.repair.finalPatch?.slice(0, 1800) ?? attempts.slice(0, 1500));
      lines.push("```");
    }
    if (finding.verification) {
      const steps = finding.verification.steps
        .map((step) => `${step.skipped ? "skipped" : step.passed ? "pass" : "fail"} · ${step.kind}`)
        .join("\n");
      lines.push(`**Verification:** ${finding.verification.passed ? "passed" : "failed"}\n\`\`\`\n${steps}\n\`\`\``);
    }
    if (finding.review) {
      lines.push(`**Astra:** ${finding.review.validity} / fix ${finding.review.fixCorrectness} / risk ${finding.review.risk} / ${finding.review.approval}`);
      lines.push(`> ${finding.review.summary}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  const staticOnly = result.decisions.filter((decision) => decision.verdict === "STATIC_ONLY");
  if (staticOnly.length > 0) {
    lines.push("<details>");
    lines.push(`<summary>Static observations (${staticOnly.length})</summary>`);
    lines.push("");
    for (const decision of staticOnly) {
      const candidate = result.candidates.find((entry) => entry.id === decision.candidateId);
      if (candidate) lines.push(`- **${candidate.severity.toUpperCase()}** (\`${candidate.evidence[0] ?? candidate.file ?? "n/a"}\`) — ${shortClaim(candidate.claim, 220)}`);
    }
    lines.push("");
    lines.push("</details>");
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Cortado investigated ${result.candidates.length} candidate(s), proved ${result.proofs.filter((proof) => proof.status === "confirmed").length} by execution and verified ${summary.issuesVerified} fix(es)._`);
  return lines.join("\n");
}

export function buildInlineComments(result: ReviewResult): NonNullable<PullRequestReviewInput["comments"]> {
  const comments: NonNullable<PullRequestReviewInput["comments"]> = [];
  for (const finding of result.findings) {
    const file = finding.candidate.file;
    const line = finding.candidate.line;
    if (!file || line === undefined) continue;
    if (!lineInDiff(result, file, line)) continue;
    const suggestion = suggestionFor(finding, result);
    const parts: string[] = [];
    if (suggestion) {
      const verified = finding.verification?.passed ? "verified" : "proposed";
      parts.push(`**Cortado ${verified} fix** — ${shortClaim(finding.candidate.claim, 220)}`);
      parts.push("");
      parts.push(`Reproduced with ${finding.proof.strategy}: ${finding.proof.explanation}`);
      parts.push("");
      parts.push("```suggestion");
      parts.push(suggestion.replace.replace(/\n$/, ""));
      parts.push("```");
      comments.push({
        path: file,
        line: suggestion.endLine,
        start_line: suggestion.startLine,
        side: "RIGHT",
        body: parts.join("\n"),
      });
    } else {
      parts.push(`**Cortado finding** — ${shortClaim(finding.candidate.claim, 220)}`);
      parts.push("");
      parts.push(`Reproduced with ${finding.proof.strategy}: ${finding.proof.explanation}`);
      parts.push("");
      parts.push("```");
      parts.push(finding.proof.reproduction.slice(0, 900));
      parts.push("```");
      comments.push({ path: file, line, side: "RIGHT", body: parts.join("\n") });
    }
  }
  return comments.slice(0, 30);
}

export function decideReviewEvent(result: ReviewResult): "APPROVE" | "COMMENT" | "REQUEST_CHANGES" {
  const confirmed = result.findings;
  if (confirmed.length === 0) {
    return result.summary.staticOnly > 0 ? "COMMENT" : "APPROVE";
  }
  const unlifted = confirmed.some((finding) => {
    const verified = finding.repair?.exit === "VERIFIED" && finding.verification?.passed;
    return !verified && SEVERITY_ORDER[finding.candidate.severity] >= SEVERITY_ORDER.medium;
  });
  return unlifted ? "REQUEST_CHANGES" : "COMMENT";
}

export function decideCheckConclusion(result: ReviewResult): CreateCheckRunInput["conclusion"] {
  const confirmed = result.findings;
  if (confirmed.length === 0) return result.summary.staticOnly > 0 ? "neutral" : "success";
  const blocking = confirmed.some((finding) => {
    const verified = finding.repair?.exit === "VERIFIED" && finding.verification?.passed;
    return !verified && SEVERITY_ORDER[finding.candidate.severity] >= SEVERITY_ORDER.high;
  });
  if (blocking) return "failure";
  const allVerified = confirmed.every((finding) => finding.repair?.exit === "VERIFIED" && finding.verification?.passed);
  return allVerified ? "success" : "neutral";
}

export async function startReviewCheckRun(input: {
  installationId: string | number;
  fullName: string;
  headSha: string;
  runId: string;
}): Promise<number | undefined> {
  try {
    const handle = await createCheckRun(input.installationId, input.fullName, {
      name: "Cortado",
      headSha: input.headSha,
      status: "in_progress",
      externalId: `cortado:${input.runId}`,
      title: "Cortado is investigating the pull request",
      summary: "Investigating changes, proving defects by execution, and repairing verified issues.",
    });
    return handle.id;
  } catch {
    return undefined;
  }
}

export async function finishCheckRun(input: PublishInput): Promise<void> {
  if (!input.checkRunId) return;
  const verified = input.result.summary.issuesVerified;
  const confirmed = input.result.summary.issuesConfirmed;
  try {
    await updateCheckRun(input.installationId, input.fullName, input.checkRunId, {
      status: "completed",
      conclusion: decideCheckConclusion(input.result) as any,
      title: verified > 0 ? `Cortado: ${verified} issue(s) fixed and verified` : confirmed > 0 ? `Cortado: ${confirmed} issue(s) confirmed` : "Cortado: no confirmed issues",
      summary: `${input.result.summary.issuesFound} candidate(s) · ${confirmed} confirmed · ${input.result.summary.issuesFixed} fixed · ${verified} verified`,
    });
  } catch {
    // check runs are best-effort
  }
}

export async function publishReview(input: PublishInput): Promise<{ id: number; url: string | null } | undefined> {
  try {
    const event = decideReviewEvent(input.result);
    return await createPullRequestReview(input.installationId, input.fullName, input.prNumber, {
      event,
      body: buildReviewBody(input.result),
      comments: buildInlineComments(input.result),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/suggestion|line|position|422/i.test(message)) {
      try {
        return await createPullRequestReview(input.installationId, input.fullName, input.prNumber, {
          event: decideReviewEvent(input.result),
          body: buildReviewBody(input.result),
          comments: [],
        });
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}
