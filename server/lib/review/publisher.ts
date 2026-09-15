import type { Finding, ReviewResult } from "../../../cortardobot/src/v3/types.ts";
import { locateEdit } from "../../../cortardobot/src/v3/patch.ts";
import { findingState, isVerifiedFix, patchHasHunks } from "../../../cortardobot/src/v3/result.ts";
import {
  createCheckRun,
  createPullRequestReview,
  dismissPullRequestReview,
  listPullRequestReviews,
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
  /** Outcome of opt-in auto-commit, surfaced on the check run (3.2). */
  autoCommitNote?: string;
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

/** All RIGHT-side line numbers present in the PR diff for a file. */
function diffRightLines(result: ReviewResult, file: string): Set<number> {
  const lines = new Set<number>();
  const parsed = result.context?.files.find((entry) => entry.path === file);
  if (!parsed) return lines;
  for (const hunk of parsed.hunks) {
    for (const diffLine of hunk.lines) {
      if (diffLine.newLine !== undefined && diffLine.type !== "-") lines.add(diffLine.newLine);
    }
  }
  return lines;
}

function lineInDiff(result: ReviewResult, file: string, line: number): boolean {
  return diffRightLines(result, file).has(line);
}

function rangeInDiff(result: ReviewResult, file: string, startLine: number, endLine: number): boolean {
  const lines = diffRightLines(result, file);
  if (lines.size === 0) return false;
  for (let line = startLine; line <= endLine; line++) {
    if (!lines.has(line)) return false;
  }
  return true;
}

/**
 * A suggestion is only produced when the repair is genuinely verified, the
 * patch has hunks, and the replaced range exists on the RIGHT side of the PR
 * diff. Anything else must be reported as a finding, never as an applied fix.
 */
function suggestionFor(finding: Finding, result: ReviewResult): Suggestion | undefined {
  const repair = finding.repair;
  if (!repair || !isVerifiedFix(finding) || !patchHasHunks(repair.finalPatch) || !repair.finalEdits || repair.finalEdits.length === 0) {
    return undefined;
  }
  const file = finding.candidate.file;
  if (!file) return undefined;
  const edit = repair.finalEdits.find((entry) => entry.path === file);
  if (!edit) return undefined;
  const parsed = result.context?.files.find((entry) => entry.path === file);
  if (!parsed?.content) return undefined;
  const location = locateEdit(parsed.content, edit);
  if (!location) return undefined;
  if (location.replaceLines.join("\n") === location.findLines.join("\n")) return undefined;
  if (!rangeInDiff(result, file, location.startLine, location.endLine)) return undefined;
  return { startLine: location.startLine, endLine: location.endLine, replace: edit.replace };
}

function findingStatus(finding: Finding): string {
  const state = findingState(finding);
  if (state === "VERIFIED_FIX") return "fixed and verified";
  if (finding.repair?.exit === "VERIFIED") return "fix unverified (no valid patch)";
  if (finding.repair?.exit === "UNSAFE") return "fix rejected as unsafe";
  if (finding.repair?.exit === "BUDGET_EXHAUSTED") return "repair budget exhausted";
  if (finding.repair) return "reproduced, fix unresolved";
  return "reproduced";
}

function verificationLines(finding: Finding): string[] {
  if (!finding.verification) return [];
  const lines = [`**Fix verification:** ${finding.verification.passed ? "passed" : "failed"}`];
  for (const step of finding.verification.steps) {
    const status = step.skipped ? "skipped" : step.passed ? "pass" : "fail";
    lines.push(`- ${status} · ${step.kind}: ${step.reason}`);
    if (!step.skipped && step.output && !step.passed) lines.push(`  \`\`\`\n  ${step.output.split("\n").slice(0, 6).join("\n  ")}\n  \`\`\``);
  }
  return lines;
}

export function buildReviewBody(result: ReviewResult): string {
  const lines: string[] = [];
  lines.push("## Cortado Review");
  lines.push("");
  const { summary } = result;
  lines.push(
    `${summary.issuesFound} issue(s) found · **${summary.issuesConfirmed} confirmed** · **${summary.issuesVerified} fixed and verified**`,
  );
  lines.push("");
  lines.push(
    `_${result.pr.classification.join(" / ")} · ${result.pr.size} change · ${(summary.durationMs / 1000).toFixed(1)}s · ` +
      `models: \`${result.models.luna}\`, \`${result.models.terra}\`, \`${result.models.astra}\` · ` +
      `${summary.modelCalls} model calls · $${summary.costUsd.toFixed(4)}_`,
  );
  if (summary.maxAttempts > 0) lines.push(`_Repair attempts: max ${summary.maxAttempts} per finding._`);
  if (result.degraded) lines.push(`> ⚠️ Degraded run: ${result.degradedReason ?? "a stage hit its budget"}`);
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
    lines.push(`**Defect reproduction (pre-fix, ${finding.proof.strategy}):**`);
    lines.push("```");
    lines.push(finding.proof.reproduction.slice(0, 1200));
    lines.push("```");
    if (finding.repair) {
      lines.push(`**Repair:** ${finding.repair.exit} — ${finding.repair.reason}`);
      if (patchHasHunks(finding.repair.finalPatch) && finding.repair.finalPatch) {
        lines.push("```diff");
        lines.push(finding.repair.finalPatch.slice(0, 1800));
        lines.push("```");
      } else {
        lines.push("_No patch was produced for this finding._");
      }
    }
    for (const line of verificationLines(finding)) lines.push(line);
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
  lines.push(`_Cortado investigated ${result.candidates.length} candidate(s), proved ${result.proofs.filter((proof) => proof.status === "confirmed").length} by execution and verified ${summary.issuesVerified} fix(es). Run \`${result.runId}\` (engine 3.1). Cache: ${summary.cacheHits} hit / ${summary.cacheMisses} miss._`);
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
    if (suggestion) {
      const parts: string[] = [];
      parts.push(`**Cortado verified fix** — ${shortClaim(finding.candidate.claim, 220)}`);
      parts.push("");
      for (const entry of verificationLines(finding)) parts.push(entry);
      parts.push("");
      parts.push(`Defect reproduction (pre-fix): ${finding.proof.explanation}`);
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
      const parts: string[] = [];
      const state = findingState(finding);
      parts.push(`**Cortado finding** — ${shortClaim(finding.candidate.claim, 220)}`);
      parts.push("");
      parts.push(`Defect reproduction: ${finding.proof.explanation}`);
      parts.push("");
      parts.push("```");
      parts.push(finding.proof.reproduction.slice(0, 900));
      parts.push("```");
      if (state === "UNRESOLVED" && finding.repair) {
        parts.push("");
        parts.push(`Fix status: **${findingStatus(finding)}** — ${finding.repair.reason}`);
        if (patchHasHunks(finding.repair.finalPatch) && finding.repair.finalPatch) {
          parts.push("");
          parts.push("Proposed patch (not applied):");
          parts.push("```diff");
          parts.push(finding.repair.finalPatch.slice(0, 900));
          parts.push("```");
        }
      }
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
    const verified = isVerifiedFix(finding);
    return !verified && SEVERITY_ORDER[finding.candidate.severity] >= SEVERITY_ORDER.medium;
  });
  return unlifted ? "REQUEST_CHANGES" : "COMMENT";
}

export function decideCheckConclusion(result: ReviewResult): CreateCheckRunInput["conclusion"] {
  const confirmed = result.findings;
  if (result.status === "failed" || result.degraded) return "neutral";
  if (confirmed.length === 0) return result.summary.staticOnly > 0 ? "neutral" : "success";
  const blocking = confirmed.some((finding) => {
    const verified = isVerifiedFix(finding);
    return !verified && SEVERITY_ORDER[finding.candidate.severity] >= SEVERITY_ORDER.high;
  });
  if (blocking) return "failure";
  const allVerified = confirmed.every((finding) => isVerifiedFix(finding));
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
      summary:
        `${input.result.summary.issuesFound} candidate(s) · ${confirmed} confirmed · ${verified} verified${input.result.degraded ? " · degraded run" : ""}` +
        (input.autoCommitNote ? `\n\n${input.autoCommitNote.slice(0, 900)}` : ""),
    });
  } catch {
    // check runs are best-effort
  }
}

/**
 * Idempotent publishing: dismiss the bot's previous review for the same head
 * SHA so a re-run replaces the old verdict instead of stacking new reviews.
 */
export async function dismissPreviousBotReviews(input: {
  installationId: string | number;
  fullName: string;
  prNumber: number;
  headSha: string;
  logger?: { info: (message: string) => void; warn: (message: string) => void };
}): Promise<void> {
  try {
    const reviews = await listPullRequestReviews(input.installationId, input.fullName, input.prNumber);
    const stale = reviews.filter(
      (review) =>
        review.commitId === input.headSha &&
        review.state !== "DISMISSED" &&
        review.body.startsWith("## Cortado Review") &&
        (review.userType === "Bot" || (review.userLogin ?? "").toLowerCase().includes("cortado")),
    );
    for (const review of stale) {
      try {
        await dismissPullRequestReview(
          input.installationId,
          input.fullName,
          input.prNumber,
          review.id,
          "Superseded by a newer Cortado review for this commit.",
        );
        input.logger?.info(`dismissed previous Cortado review ${review.id}`);
      } catch (error) {
        input.logger?.warn(`could not dismiss review ${review.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    input.logger?.warn(`could not list previous reviews: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function publishReview(
  input: PublishInput,
  logger?: { info: (message: string) => void; warn: (message: string) => void },
): Promise<{ id: number; url: string | null } | undefined> {
  try {
    await dismissPreviousBotReviews({ ...input, logger });
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
