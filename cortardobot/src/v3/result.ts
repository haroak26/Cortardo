import type {
  AstraReview,
  CacheStatsSnapshot,
  Candidate,
  Finding,
  FindingState,
  JudgeDecision,
  PRContext,
  ProofResult,
  RepairResult,
  ReviewResult,
  VerificationReport,
} from "./types";

export function patchHasHunks(patch: string | undefined): boolean {
  return Boolean(patch && /\n@@|^@@/m.test(patch));
}

/**
 * The single definition of a verified fix used by the engine, the publisher,
 * persistence and the check run. Everything that reports a fix must use this.
 */
export function isVerifiedFix(finding: Finding): boolean {
  return Boolean(
    finding.repair &&
      finding.repair.exit === "VERIFIED" &&
      finding.verification?.passed === true &&
      patchHasHunks(finding.repair.finalPatch),
  );
}

export function findingState(finding: Finding): FindingState {
  if (isVerifiedFix(finding)) return "VERIFIED_FIX";
  if (finding.proof.status !== "confirmed") return "UNSUPPORTED";
  return "UNRESOLVED";
}

export function runState(result: Pick<ReviewResult, "status" | "findings" | "summary">): FindingState | "FAILED" {
  if (result.status === "failed") return "FAILED";
  if (result.findings.some((finding) => findingState(finding) === "VERIFIED_FIX")) return "VERIFIED_FIX";
  if (result.findings.length > 0) return "UNRESOLVED";
  return "UNSUPPORTED";
}

export function buildFindings(
  confirmed: ProofResult[],
  candidates: Candidate[],
  repairs: RepairResult[],
  verifications: Record<string, VerificationReport>,
  reviews: AstraReview[],
): Finding[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const repairById = new Map(repairs.map((repair) => [repair.candidateId, repair]));
  const reviewById = new Map(reviews.map((review) => [review.candidateId, review]));
  const severityWeight: Record<string, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };
  return confirmed
    .map((proof) => {
      const candidate = byId.get(proof.candidateId);
      if (!candidate) return undefined;
      const finding: Finding = {
        candidate,
        proof,
        repair: repairById.get(candidate.id),
        verification: verifications[candidate.id],
        review: reviewById.get(candidate.id),
      };
      return finding;
    })
    .filter((finding): finding is Finding => Boolean(finding))
    .sort(
      (a, b) =>
        (severityWeight[b.candidate.severity] ?? 0) - (severityWeight[a.candidate.severity] ?? 0) ||
        b.candidate.confidence - a.candidate.confidence,
    );
}

function verificationSummary(finding: Finding): string {
  if (!finding.verification) return "not run";
  const steps = finding.verification.steps
    .filter((step) => !step.skipped)
    .map((step) => `${step.kind}:${step.passed ? "pass" : "fail"}`)
    .join(" · ");
  return `${finding.verification.passed ? "passed" : "failed"} (${steps || "no steps"})`;
}

export function formatMarkdown(result: Omit<ReviewResult, "markdown">): string {
  const lines: string[] = [];
  lines.push("# Cortado Review");
  lines.push("");
  if (result.status === "failed") {
    lines.push(`Run failed: ${result.error ?? "unknown error"}`);
    return lines.join("\n");
  }
  const { summary } = result;
  lines.push(
    `${summary.issuesFound} issue(s) found · ${summary.issuesConfirmed} confirmed · ${summary.issuesFixed} fixed · ${summary.issuesVerified} verified · ${(summary.durationMs / 1000).toFixed(1)}s`,
  );
  lines.push("");
  lines.push(
    `Classification: ${result.pr.classification.join(" / ")} · Size: ${result.pr.size} · ` +
      `Models: luna=${result.models.luna} terra=${result.models.terra} astra=${result.models.astra} · ` +
      `Model calls: ${summary.modelCalls} · Cost: $${summary.costUsd.toFixed(4)} · ` +
      `Cache: ${summary.cacheHits} hit / ${summary.cacheMisses} miss (saved $${summary.creditsSavedUsd.toFixed(4)})`,
  );
  if (result.degraded) {
    lines.push("");
    lines.push(`> Degraded run: ${result.degradedReason ?? "one or more stages hit their budget"}`);
  }
  lines.push("");
  if (result.findings.length === 0) {
    lines.push("No confirmed issues. Nothing to fix.");
    lines.push("");
  }
  for (const finding of result.findings) {
    const state = findingState(finding);
    const tag = state === "VERIFIED_FIX" ? "FIXED AND VERIFIED" : state === "UNSUPPORTED" ? "UNPROVEN" : "CONFIRMED, NOT FIXED";
    lines.push(`## [${tag}] ${finding.candidate.severity.toUpperCase()} — ${finding.candidate.claim}`);
    lines.push(`File: \`${finding.candidate.file}:${finding.candidate.line}\``);
    lines.push(`Evidence: ${finding.candidate.evidence.join(", ")}`);
    lines.push(`Defect reproduction: ${finding.proof.reproduction.split("\n")[0]} (${finding.proof.strategy})`);
    if (finding.candidate.check) lines.push(`Check: ${finding.candidate.check.label} at \`${finding.candidate.check.path}\``);
    if (finding.repair) {
      lines.push(`Repair: ${finding.repair.exit} — ${finding.repair.reason} (${finding.repair.attempts.length} attempt(s))`);
      if (patchHasHunks(finding.repair.finalPatch) && finding.repair.finalPatch) {
        lines.push("```diff");
        lines.push(finding.repair.finalPatch.slice(0, 1200));
        lines.push("```");
      } else if (state !== "VERIFIED_FIX") {
        lines.push("No patch was produced for this finding.");
      }
    }
    if (finding.verification) {
      lines.push(`Fix verification: ${verificationSummary(finding)}`);
      const reproduction = finding.verification.steps.find((step) => step.kind === "reproduction");
      if (reproduction?.reason) lines.push(`  ${reproduction.passed ? "✓" : "✗"} ${reproduction.reason}`);
    }
    if (finding.review) {
      lines.push(`Astra: ${finding.review.validity} / fix ${finding.review.fixCorrectness} / risk ${finding.review.risk} / ${finding.review.approval}`);
      lines.push(finding.review.summary);
    }
    lines.push("");
  }

  const staticOnly = result.decisions.filter((decision) => decision.verdict === "STATIC_ONLY");
  if (staticOnly.length > 0) {
    lines.push(`## Static only (${staticOnly.length})`);
    for (const decision of staticOnly) {
      const candidate = result.candidates.find((item) => item.id === decision.candidateId);
      if (candidate) lines.push(`- ${candidate.severity.toUpperCase()} — ${candidate.claim} (${candidate.evidence[0] ?? candidate.file ?? "n/a"})`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

export function maxRepairAttempts(repairs: RepairResult[]): number {
  return repairs.reduce((max, repair) => Math.max(max, repair.attempts.length), 0);
}

export function summaryFrom(
  candidates: Candidate[],
  decisions: JudgeDecision[],
  proofs: ProofResult[],
  repairs: RepairResult[],
  findings: Finding[],
  startedAt: number,
  endedAt: number,
  usage: ReviewResult["usage"],
  cache: CacheStatsSnapshot,
): ReviewResult["summary"] {
  return {
    issuesFound: candidates.length,
    issuesConfirmed: proofs.filter((proof) => proof.status === "confirmed").length,
    issuesFixed: repairs.filter((repair) => repair.exit === "VERIFIED").length,
    issuesVerified: findings.filter((finding) => isVerifiedFix(finding)).length,
    staticOnly: decisions.filter((decision) => decision.verdict === "STATIC_ONLY").length,
    discarded: decisions.filter((decision) => decision.verdict === "DISCARD").length,
    durationMs: endedAt - startedAt,
    modelCalls: usage.calls,
    costUsd: usage.costUsd,
    cacheHits: cache.hits,
    cacheMisses: cache.misses,
    creditsSavedUsd: cache.creditsSavedUsd,
    maxAttempts: maxRepairAttempts(repairs),
  };
}

export function contextSummary(context: PRContext | null): string {
  if (!context) return "no context";
  return `${context.files.length} file(s), +${context.additions}/-${context.deletions}, ${context.classification.join("/")}, ${context.size}`;
}
