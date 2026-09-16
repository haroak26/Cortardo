import type { Candidate, Finding, ReviewResult } from "../../../cortardobot/src/v3/types.ts";
import { locateEdit } from "../../../cortardobot/src/v3/patch.ts";
import { findingState, isVerifiedFix, patchHasHunks } from "../../../cortardobot/src/v3/result.ts";
import { ENGINE_VERSION } from "../../../cortardobot/src/v3/version.ts";
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

const MAX_REVIEW_BODY_CHARS = 60_000;

function verdictLabel(decision: "approve" | "approve_with_comments" | "request_changes"): string {
  if (decision === "approve") return "**APPROVE**";
  if (decision === "approve_with_comments") return "**APPROVE WITH COMMENTS**";
  return "**REQUEST CHANGES**";
}

/** PR-level report sections rendered at the top of the review body (3.3). */
function reportLines(result: ReviewResult): string[] {
  const report = result.reviewReport;
  if (!report) return [];
  const lines: string[] = [];
  lines.push(`## Final verdict: ${verdictLabel(report.verdict.decision)} · confidence ${(report.verdict.confidence * 100).toFixed(0)}%`);
  lines.push("");
  if (report.verdict.rationale) {
    for (const paragraph of report.verdict.rationale.split(/\n{2,}/).slice(0, 4)) lines.push(`> ${paragraph.trim()}`);
    lines.push("");
  }
  if (report.summary) {
    lines.push(report.summary);
    lines.push("");
  }
  if (report.walkthrough.length > 0) {
    lines.push("### Walkthrough");
    lines.push("| File | Intent | Change | Risk |");
    lines.push("| --- | --- | --- | --- |");
    for (const entry of report.walkthrough.slice(0, 20)) {
      lines.push(`| \`${entry.file}\` | ${shortClaim(entry.intent, 120)} | ${shortClaim(entry.changeSummary, 200)} | ${entry.risk.toUpperCase()} |`);
    }
    lines.push("");
  }
  if (report.risks.length > 0) {
    lines.push("### Risks");
    lines.push("| Area | Severity | Rationale | Mitigation |");
    lines.push("| --- | --- | --- | --- |");
    for (const risk of report.risks.slice(0, 15)) {
      lines.push(`| ${shortClaim(risk.area, 100)} | ${risk.severity.toUpperCase()} | ${shortClaim(risk.rationale, 240)} | ${shortClaim(risk.mitigation ?? "—", 160)} |`);
    }
    lines.push("");
  }
  if (report.testCoverage.assessed || report.testCoverage.signals.length > 0 || report.testCoverage.gaps.length > 0) {
    lines.push("### Test coverage");
    for (const signal of report.testCoverage.signals.slice(0, 10)) lines.push(`- Covered: ${shortClaim(signal, 200)}`);
    for (const gap of report.testCoverage.gaps.slice(0, 10)) lines.push(`- Gap: ${shortClaim(gap, 200)}`);
    if (report.testCoverage.signals.length === 0 && report.testCoverage.gaps.length === 0) lines.push("- No coverage signals were provided.");
    lines.push("");
  }
  if (report.observations.length > 0) {
    lines.push("### Observations");
    for (const observation of report.observations.slice(0, 10)) lines.push(`- **${shortClaim(observation.kind, 80)}** — ${shortClaim(observation.detail, 300)}`);
    lines.push("");
  }
  if (report.limitations.length > 0) {
    lines.push("### Limitations");
    for (const limitation of report.limitations.slice(0, 10)) lines.push(`- ${shortClaim(limitation, 300)}`);
    lines.push("");
  }
  if (report.source === "fallback") lines.push("> ⚠️ The PR report is the deterministic fallback; the reviewer model did not complete.");
  lines.push("");
  return lines;
}

/** Static-only candidates (judge STATIC_ONLY, never confirmed by execution). */
function staticOnlyCandidates(result: ReviewResult): Candidate[] {
  const byId = new Map(result.candidates.map((candidate) => [candidate.id, candidate]));
  return result.decisions
    .filter((decision) => decision.verdict === "STATIC_ONLY")
    .map((decision) => byId.get(decision.candidateId))
    .filter((candidate): candidate is Candidate => Boolean(candidate));
}

function isPublishableStatic(candidate: Candidate): boolean {
  return candidate.severity === "critical" || candidate.severity === "high" || candidate.severity === "medium";
}

/**
 * Proof coverage for the PR body: what the loop was asked to prove and what it
 * managed to reproduce. A run where nothing could be proven must say so here
 * (3.4) instead of reading like a clean review.
 */
function loopLines(result: ReviewResult): string[] {
  const loop = result.loop;
  if (!loop || loop.judgeProve === 0) return [];
  const lines: string[] = [];
  lines.push("### Proof coverage");
  lines.push("");
  lines.push(
    `Judge approved ${loop.judgeProve} candidate(s) · **${loop.proven} proven by execution** · ${loop.proofUnavailable} unprovable · ${loop.proofErrors} errored`,
  );
  for (const entry of loop.candidates.filter((item) => item.proofState !== "PROVEN").slice(0, 10)) {
    const candidate = result.candidates.find((item) => item.id === entry.candidateId);
    lines.push(
      `- [${entry.severity}] ${shortClaim(candidate?.claim ?? entry.candidateId, 200)} (\`${candidate?.file ?? "n/a"}:${candidate?.line ?? "?"}\`) — ${entry.proofState.toLowerCase()}: ${shortClaim(entry.reason, 200)}`,
    );
  }
  lines.push("");
  return lines;
}

function clampReviewBody(body: string): string {
  if (body.length <= MAX_REVIEW_BODY_CHARS) return body;
  const note = `\n\n> ⚠️ Review truncated at ${MAX_REVIEW_BODY_CHARS.toLocaleString()} characters; see the run details for the full report.`;
  return `${body.slice(0, MAX_REVIEW_BODY_CHARS - note.length)}${note}`;
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
      `models: \`${result.models.luna}\`, \`${result.models.terra}\`, \`${result.models.codegen}\`, \`${result.models.astra}\` · ` +
      `${summary.modelCalls} model calls · $${summary.costUsd.toFixed(4)}_`,
  );
  if (summary.maxAttempts > 0) lines.push(`_Repair attempts: max ${summary.maxAttempts} per finding._`);
  if (result.degraded) lines.push(`> ⚠️ Degraded run: ${result.degradedReason ?? "a stage hit its budget"}`);
  lines.push("");

  lines.push(...reportLines(result));
  lines.push(...loopLines(result));

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
      lines.push(`**Reviewer:** ${finding.review.validity} / fix ${finding.review.fixCorrectness} / risk ${finding.review.risk} / ${finding.review.approval} (confidence ${(finding.review.confidence * 100).toFixed(0)}%)`);
      lines.push(`> ${finding.review.summary}`);
      if (finding.review.rationale) lines.push(`> ${finding.review.rationale.replace(/\n/g, " ")}`);
      if (finding.review.evidenceRefs && finding.review.evidenceRefs.length > 0) {
        lines.push(`> Evidence: ${finding.review.evidenceRefs.slice(0, 6).map((ref) => `\`${ref}\``).join(", ")}`);
      }
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
  const swarm = result.swarm;
  const swarmNote = swarm
    ? ` Swarm: ${swarm.mode}, ${swarm.agents.length} agent(s), ${swarm.hypotheses} hypothesis(es), ${swarm.candidates} candidate(s).`
    : "";
  lines.push(
    `_Cortado investigated ${result.candidates.length} candidate(s), proved ${result.proofs.filter((proof) => proof.status === "confirmed").length} by execution and verified ${summary.issuesVerified} fix(es). Run \`${result.runId}\` (engine ${ENGINE_VERSION}).${swarmNote} Cache: ${summary.cacheHits} hit / ${summary.cacheMisses} miss._`,
  );
  return clampReviewBody(lines.join("\n"));
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
  // Static-only findings must still be visible on the PR; they are published
  // as clearly-labelled, non-blocking comments (3.4). They never drive
  // REQUEST_CHANGES on their own — the verdict handles that.
  for (const candidate of staticOnlyCandidates(result)) {
    if (!isPublishableStatic(candidate)) continue;
    const file = candidate.file;
    const line = candidate.line;
    if (!file || line === undefined || !lineInDiff(result, file, line)) continue;
    const parts: string[] = [];
    parts.push(`**Cortado static finding (unproven)** — ${shortClaim(candidate.claim, 220)}`);
    parts.push("");
    parts.push(
      "This candidate was reported from static analysis. The autonomous loop could not produce an executable reproduction for it, so it is neither confirmed nor fixed.",
    );
    if (candidate.evidence.length > 0) parts.push(`Evidence: ${candidate.evidence.join(", ")}`);
    if (candidate.suggestedExperiment) parts.push(`Suggested experiment: ${shortClaim(candidate.suggestedExperiment, 300)}`);
    comments.push({ path: file, line, side: "RIGHT", body: parts.join("\n") });
  }
  return comments.slice(0, 30);
}

/** Static-only decisions recorded on the run, independent of the summary. */
function staticOnlyCount(result: ReviewResult): number {
  const fromDecisions = result.decisions.filter((decision) => decision.verdict === "STATIC_ONLY").length;
  return Math.max(fromDecisions, result.summary.staticOnly);
}

export function decideReviewEvent(result: ReviewResult): "APPROVE" | "COMMENT" | "REQUEST_CHANGES" {
  const confirmed = result.findings;
  const report = result.reviewReport;
  const unlifted = confirmed.some((finding) => {
    const verified = isVerifiedFix(finding);
    return !verified && SEVERITY_ORDER[finding.candidate.severity] >= SEVERITY_ORDER.medium;
  });
  if (unlifted) return "REQUEST_CHANGES";
  if (result.status === "failed") return "COMMENT";
  if (report?.verdict.decision === "request_changes") return "REQUEST_CHANGES";
  // A degraded run never approves, even when the deterministic output is empty.
  if (result.degraded || report?.source === "fallback") return "COMMENT";
  if (confirmed.length === 0) {
    if (staticOnlyCount(result) > 0) return "COMMENT";
    return report?.verdict.decision === "approve_with_comments" ? "COMMENT" : "APPROVE";
  }
  return "COMMENT";
}

export function decideCheckConclusion(result: ReviewResult): CreateCheckRunInput["conclusion"] {
  const confirmed = result.findings;
  if (result.status === "failed" || result.degraded) return "neutral";
  const report = result.reviewReport;
  const reportRequestsChanges = report?.verdict.decision === "request_changes";
  if (confirmed.length === 0) {
    if (staticOnlyCount(result) > 0) return "neutral";
    return reportRequestsChanges ? "neutral" : "success";
  }
  const blocking = confirmed.some((finding) => {
    const verified = isVerifiedFix(finding);
    return !verified && SEVERITY_ORDER[finding.candidate.severity] >= SEVERITY_ORDER.high;
  });
  if (blocking) return "failure";
  const allVerified = confirmed.every((finding) => isVerifiedFix(finding));
  if (allVerified) return reportRequestsChanges ? "neutral" : "success";
  return "neutral";
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

export function buildCheckRunText(result: ReviewResult): string | undefined {
  const report = result.reviewReport;
  if (!report) return undefined;
  const lines: string[] = [];
  lines.push(`## Verdict: ${report.verdict.decision.replace(/_/g, " ")} (confidence ${(report.verdict.confidence * 100).toFixed(0)}%)`);
  if (report.verdict.rationale) lines.push("", report.verdict.rationale);
  if (report.summary) lines.push("", report.summary);
  if (report.risks.length > 0) {
    lines.push("", "### Risks");
    for (const risk of report.risks.slice(0, 10)) lines.push(`- **${risk.severity.toUpperCase()}** ${risk.area}: ${risk.rationale}${risk.mitigation ? ` (mitigation: ${risk.mitigation})` : ""}`);
  }
  if (report.limitations.length > 0) {
    lines.push("", "### Limitations");
    for (const limitation of report.limitations.slice(0, 10)) lines.push(`- ${limitation}`);
  }
  lines.push(...loopLines(result));
  return lines.join("\n").slice(0, 65_000);
}

/** Terminates a check run that will never complete (engine crash, lost lease). */
export async function failCheckRun(input: {
  installationId: string | number;
  fullName: string;
  checkRunId: number;
  reason: string;
}): Promise<void> {
  try {
    await updateCheckRun(input.installationId, input.fullName, input.checkRunId, {
      status: "completed",
      conclusion: "neutral",
      title: "Cortado: run failed",
      summary: `The review run did not complete: ${input.reason}`.slice(0, 900),
    });
  } catch {
    // check runs are best-effort
  }
}

export async function finishCheckRun(input: PublishInput): Promise<void> {
  if (!input.checkRunId) return;
  const verified = input.result.summary.issuesVerified;
  const confirmed = input.result.summary.issuesConfirmed;
  const requestsChanges = input.result.reviewReport?.verdict.decision === "request_changes";
  const loop = input.result.loop;
  const unprovenNote = loop && loop.judgeProve > 0 && loop.proven < loop.judgeProve ? ` · ${loop.judgeProve - loop.proven} unproven` : "";
  try {
    await updateCheckRun(input.installationId, input.fullName, input.checkRunId, {
      status: "completed",
      conclusion: decideCheckConclusion(input.result) as any,
      title:
        verified > 0
          ? `Cortado: ${verified} issue(s) fixed and verified`
          : confirmed > 0
            ? `Cortado: ${confirmed} issue(s) confirmed`
            : requestsChanges
              ? "Cortado: changes requested — no verified fixes"
              : `Cortado: no confirmed issues${unprovenNote}`,
      summary:
        `${input.result.summary.issuesFound} candidate(s) · ${confirmed} confirmed · ${verified} verified${input.result.degraded ? " · degraded run" : ""}` +
        (input.autoCommitNote ? `\n\n${input.autoCommitNote.slice(0, 900)}` : ""),
      text: buildCheckRunText(input.result),
    });
  } catch {
    // check runs are best-effort
  }
}

/**
 * GitHub only allows dismissing APPROVED / CHANGES_REQUESTED reviews; a
 * COMMENTED review returns 422, so it is never selected here.
 */
export function shouldDismissBotReview(
  review: { state?: string | null; commitId?: string | null; body?: string | null; userType?: string | null; userLogin?: string | null },
  headSha: string,
): boolean {
  const dismissableState = review.state === "APPROVED" || review.state === "CHANGES_REQUESTED";
  return (
    dismissableState &&
    review.commitId === headSha &&
    (review.body ?? "").startsWith("## Cortado Review") &&
    (review.userType === "Bot" || (review.userLogin ?? "").toLowerCase().includes("cortado"))
  );
}

/**
 * Superseded reviews for a commit. `excludeReviewId` must always be the review
 * that was just created: after create-then-dismiss the fresh review is itself
 * dismissable, and dismissing it would erase the verdict we just published.
 */
export function selectSupersededBotReviews(
  reviews: Array<{ id: number; state?: string | null; commitId?: string | null; body?: string | null; userType?: string | null; userLogin?: string | null }>,
  headSha: string,
  excludeReviewId?: number,
): typeof reviews {
  return reviews.filter((review) => review.id !== excludeReviewId && shouldDismissBotReview(review, headSha));
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
  /** Never dismiss the review that was just created (3.3). */
  excludeReviewId?: number;
  logger?: { info: (message: string) => void; warn: (message: string) => void };
}): Promise<void> {
  try {
    const reviews = await listPullRequestReviews(input.installationId, input.fullName, input.prNumber);
    const stale = selectSupersededBotReviews(reviews, input.headSha, input.excludeReviewId);
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
  const event = decideReviewEvent(input.result);
  const body = buildReviewBody(input.result);
  const comments = buildInlineComments(input.result);
  const pinned = { commitId: input.headSha };
  try {
    // Create first, then dismiss the superseded review: a failed create must
    // never leave the PR without its previous verdict.
    const created = await createPullRequestReview(input.installationId, input.fullName, input.prNumber, {
      event,
      body,
      comments,
      ...pinned,
    });
    await dismissPreviousBotReviews({ ...input, logger, excludeReviewId: created.id });
    return created;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/suggestion|line|position|422/i.test(message)) {
      logger?.warn(`inline comments were rejected (${message.slice(0, 160)}); retrying body-only`);
      try {
        const created = await createPullRequestReview(input.installationId, input.fullName, input.prNumber, {
          event,
          body,
          comments: [],
          ...pinned,
        });
        await dismissPreviousBotReviews({ ...input, logger, excludeReviewId: created.id });
        return created;
      } catch (retryError) {
        logger?.warn(`body-only review publish also failed: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        return undefined;
      }
    }
    logger?.warn(`review publish failed: ${message.slice(0, 200)}`);
    return undefined;
  }
}
