/**
 * GitHub publisher for the 3.5 engine result. The review is built from the
 * reproduction evidence: reproduced defects, verified fixes, and an honest
 * coverage section. A degraded run never approves.
 */
import type { CandidateState, EngineResult, Finding, ParsedFile, Severity } from "../../../cortardobot/src/types.ts";
import { locateEdit } from "../../../cortardobot/src/patch.ts";
import { ENGINE_VERSION } from "../../../cortardobot/src/version.ts";
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
  result: EngineResult;
  checkRunId?: number;
  autoCommitNote?: string;
}

const SEVERITY_ORDER: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function short(value: string, max = 200): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function diffRightLines(result: EngineResult, file: string): Set<number> {
  const lines = new Set<number>();
  const parsed = result.files.find((entry) => entry.path === file);
  if (!parsed) return lines;
  for (const hunk of parsed.hunks) {
    for (const diffLine of hunk.lines) {
      if (diffLine.newLine !== undefined && diffLine.type !== "-") lines.add(diffLine.newLine);
    }
  }
  return lines;
}

function lineInDiff(result: EngineResult, file: string, line: number): boolean {
  return diffRightLines(result, file).has(line);
}

function rangeInDiff(result: EngineResult, file: string, startLine: number, endLine: number): boolean {
  const lines = diffRightLines(result, file);
  if (lines.size === 0) return false;
  for (let line = startLine; line <= endLine; line += 1) {
    if (!lines.has(line)) return false;
  }
  return true;
}

interface Suggestion {
  startLine: number;
  endLine: number;
  replace: string;
}

function suggestionFor(finding: Finding, result: EngineResult): Suggestion | undefined {
  if (finding.state !== "verified_fix") return undefined;
  const edits = finding.fix?.edits ?? [];
  const file = finding.file;
  if (edits.length === 0 || !file) return undefined;
  const parsed = result.files.find((entry) => entry.path === file);
  if (!parsed?.content) return undefined;
  const lines: string[] = [];
  let startLine: number | undefined;
  let endLine: number | undefined;
  for (const edit of edits.filter((entry) => entry.path === file)) {
    const location = locateEdit(parsed.content, edit);
    if (!location) return undefined;
    if (location.replaceLines.join("\n") === location.findLines.join("\n")) return undefined;
    if (!rangeInDiff(result, file, location.startLine, location.endLine)) return undefined;
    startLine = startLine === undefined ? location.startLine : Math.min(startLine, location.startLine);
    endLine = endLine === undefined ? location.endLine : Math.max(endLine, location.endLine);
  }
  if (startLine === undefined || endLine === undefined) return undefined;
  for (const edit of edits.filter((entry) => entry.path === file)) lines.push(edit.replace);
  return { startLine, endLine, replace: lines.join("\n") };
}

function stateLabel(state: CandidateState): string {
  if (state === "verified_fix") return "fixed and verified";
  if (state === "fix_failed") return "reproduced, fix failed";
  if (state === "reproduced") return "reproduced, not fixed";
  if (state === "not_reproduced") return "not reproduced";
  if (state === "deferred") return "deferred (budget)";
  return "errored";
}

function runtimeLabel(finding: { runtime?: { surface: string; preExisting: boolean } }): string {
  if (!finding.runtime) return "";
  return finding.runtime.preExisting ? `pre-existing runtime (${finding.runtime.surface})` : `runtime ${finding.runtime.surface}`;
}

function coverageLines(result: EngineResult): string[] {
  const lines: string[] = [];
  lines.push("### Coverage");
  lines.push("");
  lines.push(
    `${result.summary.issuesFound} candidate(s) · ${result.summary.issuesReproduced} reproduced · ` +
      `${result.summary.issuesVerified} verified · ${result.summary.staticOnly} not reproduced · ` +
      `${result.summary.deferred} deferred · ${result.summary.errors} errored`,
  );
  for (const entry of result.candidates.slice(0, 20)) {
    const runtime = entry.runtime ? ` [${entry.runtime.preExisting ? "pre-existing runtime" : "runtime"} ${entry.runtime.surface}]` : "";
    lines.push(`- [${entry.severity}]${runtime} ${short(entry.claim, 180)} (\`${entry.file ?? "n/a"}\`) — ${stateLabel(entry.state)}: ${short(entry.reason, 180)}`);
  }
  if (result.report.runtime) {
    lines.push("");
    lines.push(
      result.report.runtime.status === "exercised"
        ? `Runtime exercise: exercised (${result.report.runtime.surfaces.join(", ")}).`
        : `Runtime exercise: not run — ${result.report.runtime.reason ?? "no runnable surface"}.`,
    );
  }
  lines.push("");
  return lines;
}

function findingLines(finding: Finding): string[] {
  const lines: string[] = [];
  lines.push(`<details>`);
  lines.push(`<summary><strong>${finding.severity.toUpperCase()}</strong> — ${short(finding.claim, 120)} (${stateLabel(finding.state)}${finding.runtime ? `, ${runtimeLabel(finding)}` : ""})</summary>`);
  lines.push("");
  lines.push(`**What:** ${finding.claim}`);
  lines.push(`**Where:** \`${finding.file}${finding.line ? `:${finding.line}` : ""}\``);
  if (finding.evidence.length > 0) lines.push(`**Evidence:** ${finding.evidence.join(", ")}`);
  lines.push(`**Reproduction:** \`${finding.repro.artifact.path}\` — ${short(finding.repro.explanation, 240)}`);
  lines.push("```");
  lines.push(finding.repro.output.slice(0, 1_400));
  lines.push("```");
  const fix = finding.fix;
  if (fix) {
    lines.push(`**Fix:** ${fix.state} — ${short(fix.reason, 300)}`);
    if (fix.patch && fix.patch.trim()) {
      lines.push("```diff");
      lines.push(fix.patch.slice(0, 1_800));
      lines.push("```");
    }
    if (fix.verification) {
      lines.push(`**Verification:** ${fix.verification.passed ? "passed" : "failed"}`);
      for (const step of fix.verification.steps) {
        lines.push(`- ${step.skipped ? "skipped" : step.passed ? "pass" : "fail"} · ${step.kind}: ${short(step.reason, 200)}`);
      }
    }
    if (fix.reviewer) {
      lines.push(
        `**Independent reviewer:** ${fix.reviewer.approved ? "approved" : "rejected"} / risk ${fix.reviewer.risk} / confidence ${(fix.reviewer.confidence * 100).toFixed(0)}%`,
      );
      lines.push(`> ${short(fix.reviewer.summary, 600)}`);
    }
  }
  lines.push("");
  lines.push("</details>");
  return lines;
}

const MAX_REVIEW_BODY_CHARS = 60_000;

function clampReviewBody(body: string): string {
  if (body.length <= MAX_REVIEW_BODY_CHARS) return body;
  const note = `\n\n> ⚠️ Review truncated at ${MAX_REVIEW_BODY_CHARS.toLocaleString()} characters; see the run details for the full report.`;
  return `${body.slice(0, MAX_REVIEW_BODY_CHARS - note.length)}${note}`;
}

export function buildReviewBody(result: EngineResult): string {
  const lines: string[] = [];
  lines.push("## Cortado Review");
  lines.push("");
  lines.push(
    `${result.summary.issuesReproduced} issue(s) reproduced · **${result.summary.issuesVerified} fixed and verified** · ${result.summary.staticOnly} not reproduced`,
  );
  lines.push("");
  lines.push(
    `_${result.pr.classification.join(" / ")} · ${result.pr.size} change · ${(result.summary.durationMs / 1000).toFixed(1)}s · ` +
      `models: \`${result.models.investigator}\`, \`${result.models.engineer}\`, \`${result.models.reviewer}\` · ` +
      `${result.summary.modelCalls} model calls · $${result.summary.costUsd.toFixed(4)}_`,
  );
  if (result.degraded) lines.push(`> ⚠️ Degraded run: ${result.degradedReason ?? "a stage could not finish"}`);
  lines.push("");
  lines.push(`## Final verdict: **${result.report.verdict.decision.replace(/_/g, " ").toUpperCase()}** · confidence ${(result.report.verdict.confidence * 100).toFixed(0)}%`);
  lines.push("");
  if (result.report.verdict.rationale) {
    for (const paragraph of result.report.verdict.rationale.split(/\n{2,}/).slice(0, 4)) lines.push(`> ${paragraph.trim()}`);
    lines.push("");
  }
  if (result.report.summary) {
    lines.push(result.report.summary);
    lines.push("");
  }
  lines.push(...coverageLines(result));
  for (const finding of result.findings) {
    lines.push(...findingLines(finding));
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Run \`${result.runId}\` (engine ${ENGINE_VERSION}). No reproduction, no finding; no clean replay, no verified fix._`);
  return clampReviewBody(lines.join("\n"));
}

export function buildInlineComments(result: EngineResult): NonNullable<PullRequestReviewInput["comments"]> {
  const comments: NonNullable<PullRequestReviewInput["comments"]> = [];
  for (const finding of result.findings) {
    const file = finding.file;
    if (!file || finding.line === undefined || !lineInDiff(result, file, finding.line)) continue;
    const suggestion = suggestionFor(finding, result);
    const parts: string[] = [];
    if (finding.state === "verified_fix") {
      parts.push(`**Cortado verified fix**${finding.runtime ? ` (${runtimeLabel(finding)})` : ""} — ${short(finding.claim, 220)}`);
      parts.push("");
      const verification = finding.fix?.verification;
      if (verification) parts.push(`Verified on a clean replay: ${verification.passed ? "passed" : "failed"}.`);
      parts.push("");
      parts.push(`Reproduction: \`${finding.repro.artifact.path}\` — ${short(finding.repro.explanation, 200)}`);
    } else {
      parts.push(`**Cortado finding (reproduced)${finding.runtime ? ` — ${runtimeLabel(finding)}` : ""}** — ${short(finding.claim, 220)}`);
      parts.push("");
      parts.push(`Reproduction: \`${finding.repro.artifact.path}\` — ${short(finding.repro.explanation, 200)}`);
      parts.push("");
      parts.push("```");
      parts.push(finding.repro.output.slice(0, 900));
      parts.push("```");
      if (finding.state === "fix_failed") parts.push(`Fix status: **${stateLabel(finding.state)}** — ${short(finding.fix?.reason ?? "", 240)}`);
    }
    if (suggestion) {
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
      comments.push({ path: file, line: finding.line, side: "RIGHT", body: parts.join("\n") });
    }
  }

  // Unproven high/medium candidates stay visible as labelled advisories.
  for (const candidate of result.candidates) {
    if (candidate.state !== "not_reproduced") continue;
    if ((SEVERITY_ORDER[candidate.severity] ?? 0) < SEVERITY_ORDER.medium) continue;
    const file = result.files.find((entry) => entry.path === candidate.file);
    const line = file ? firstChangedLine(file) : undefined;
    if (!file || line === undefined) continue;
    comments.push({
      path: file.path,
      line,
      side: "RIGHT",
      body: [
        `**Cortado advisory (not reproduced)** — ${short(candidate.claim, 220)}`,
        "",
        "Static analysis raised this candidate, but the engine could not produce an executable reproduction for it. It is neither confirmed nor fixed.",
      ].join("\n"),
    });
  }
  return comments.slice(0, 30);
}

function firstChangedLine(file: ParsedFile): number | undefined {
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "+" && line.newLine !== undefined) return line.newLine;
    }
  }
  return undefined;
}

export function decideReviewEvent(result: EngineResult): "APPROVE" | "COMMENT" | "REQUEST_CHANGES" {
  const unresolvedBlocking = result.findings.some(
    (finding) =>
      finding.state !== "verified_fix" &&
      (SEVERITY_ORDER[finding.severity] ?? 0) >= SEVERITY_ORDER.high &&
      !finding.runtime?.preExisting,
  );
  if (unresolvedBlocking) return "REQUEST_CHANGES";
  if (result.status === "failed") return "COMMENT";
  if (result.report.verdict.decision === "request_changes") return "REQUEST_CHANGES";
  if (result.degraded) return "COMMENT";
  if (result.findings.length === 0) {
    if (result.summary.staticOnly > 0) return "COMMENT";
    return result.report.verdict.decision === "approve_with_comments" ? "COMMENT" : "APPROVE";
  }
  return "COMMENT";
}

export function decideCheckConclusion(result: EngineResult): CreateCheckRunInput["conclusion"] {
  if (result.status === "failed" || result.degraded) return "neutral";
  if (result.findings.length === 0) {
    if (result.summary.staticOnly > 0) return "neutral";
    return result.report.verdict.decision === "request_changes" ? "neutral" : "success";
  }
  const blocking = result.findings.some(
    (finding) =>
      finding.state !== "verified_fix" &&
      (SEVERITY_ORDER[finding.severity] ?? 0) >= SEVERITY_ORDER.high &&
      !finding.runtime?.preExisting,
  );
  if (blocking) return "failure";
  const allVerified = result.findings.every((finding) => finding.state === "verified_fix");
  if (allVerified) return result.report.verdict.decision === "request_changes" ? "neutral" : "success";
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
      summary: "Reading the code, reproducing defects with scripts, fixing them and verifying on a clean replay.",
    });
    return handle.id;
  } catch {
    return undefined;
  }
}

export function buildCheckRunText(result: EngineResult): string | undefined {
  const lines: string[] = [];
  lines.push(`## Verdict: ${result.report.verdict.decision.replace(/_/g, " ")} (confidence ${(result.report.verdict.confidence * 100).toFixed(0)}%)`);
  if (result.report.verdict.rationale) lines.push("", result.report.verdict.rationale);
  if (result.report.summary) lines.push("", result.report.summary);
  lines.push(...coverageLines(result));
  for (const finding of result.findings.filter((entry) => entry.state === "fix_failed")) {
    lines.push(`- **${finding.severity.toUpperCase()}** ${short(finding.claim, 180)} — ${short(finding.fix?.reason ?? "fix failed", 240)}`);
  }
  return lines.join("\n").slice(0, 65_000);
}

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
  const { result } = input;
  const unprovenNote = result.summary.staticOnly > 0 ? ` · ${result.summary.staticOnly} not reproduced` : "";
  try {
    await updateCheckRun(input.installationId, input.fullName, input.checkRunId, {
      status: "completed",
      conclusion: decideCheckConclusion(result) as any,
      title:
        result.summary.issuesVerified > 0
          ? `Cortado: ${result.summary.issuesVerified} issue(s) fixed and verified`
          : result.summary.issuesReproduced > 0
            ? `Cortado: ${result.summary.issuesReproduced} issue(s) reproduced`
            : result.report.verdict.decision === "request_changes"
              ? "Cortado: changes requested — no verified fixes"
              : `Cortado: no reproduced issues${unprovenNote}`,
      summary:
        `${result.summary.issuesFound} candidate(s) · ${result.summary.issuesReproduced} reproduced · ${result.summary.issuesVerified} verified` +
        (result.degraded ? " · degraded run" : "") +
        (input.autoCommitNote ? `\n\n${input.autoCommitNote.slice(0, 900)}` : ""),
      text: buildCheckRunText(result),
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

export function selectSupersededBotReviews(
  reviews: Array<{ id: number; state?: string | null; commitId?: string | null; body?: string | null; userType?: string | null; userLogin?: string | null }>,
  headSha: string,
  excludeReviewId?: number,
): typeof reviews {
  return reviews.filter((review) => review.id !== excludeReviewId && shouldDismissBotReview(review, headSha));
}

export async function dismissPreviousBotReviews(input: {
  installationId: string | number;
  fullName: string;
  prNumber: number;
  headSha: string;
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
