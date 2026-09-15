import type { AstraReview, Candidate, Finding, JudgeDecision, PRContext, ProofResult, RepairResult, ReviewResult, VerificationReport } from "./types";

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
    `Classification: ${result.pr.classification.join(" / ")} · Size: ${result.pr.size} · Model calls: ${summary.modelCalls} · Cost: $${summary.costUsd.toFixed(4)}`,
  );
  lines.push("");
  if (result.findings.length === 0) {
    lines.push("No confirmed issues. Nothing to fix.");
    lines.push("");
  }
  for (const finding of result.findings) {
    const verified = finding.repair?.exit === "VERIFIED" && finding.verification?.passed;
    const tag = verified ? "FIXED AND VERIFIED" : finding.proof.status === "confirmed" ? "CONFIRMED" : "UNPROVEN";
    lines.push(`## [${tag}] ${finding.candidate.severity.toUpperCase()} — ${finding.candidate.claim}`);
    lines.push(`File: \`${finding.candidate.file}:${finding.candidate.line}\``);
    lines.push(`Evidence: ${finding.candidate.evidence.join(", ")}`);
    lines.push(`Reproduction: ${finding.proof.reproduction.split("\n")[0]} (${finding.proof.strategy})`);
    if (finding.candidate.check) lines.push(`Check: ${finding.candidate.check.label} at \`${finding.candidate.check.path}\``);
    if (finding.repair) {
      lines.push(`Repair: ${finding.repair.exit} — ${finding.repair.reason} (${finding.repair.attempts.length} attempt(s))`);
      if (finding.repair.finalPatch) {
        lines.push("```diff");
        lines.push(finding.repair.finalPatch.slice(0, 1200));
        lines.push("```");
      }
    }
    if (finding.verification) {
      const steps = finding.verification.steps
        .filter((step) => !step.skipped)
        .map((step) => `${step.kind}:${step.passed ? "pass" : "fail"}`)
        .join(" · ");
      lines.push(`Verification: ${finding.verification.passed ? "passed" : "failed"} (${steps || "no steps"})`);
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

export function summaryFrom(
  candidates: Candidate[],
  decisions: JudgeDecision[],
  proofs: ProofResult[],
  repairs: RepairResult[],
  findings: Finding[],
  startedAt: number,
  endedAt: number,
  usage: ReviewResult["usage"],
): ReviewResult["summary"] {
  return {
    issuesFound: candidates.length,
    issuesConfirmed: proofs.filter((proof) => proof.status === "confirmed").length,
    issuesFixed: repairs.filter((repair) => repair.exit === "VERIFIED").length,
    issuesVerified: findings.filter((finding) => finding.repair?.exit === "VERIFIED" && finding.verification?.passed).length,
    staticOnly: decisions.filter((decision) => decision.verdict === "STATIC_ONLY").length,
    discarded: decisions.filter((decision) => decision.verdict === "DISCARD").length,
    durationMs: endedAt - startedAt,
    modelCalls: usage.calls,
    costUsd: usage.costUsd,
  };
}

export function contextSummary(context: PRContext | null): string {
  if (!context) return "no context";
  return `${context.files.length} file(s), +${context.additions}/-${context.deletions}, ${context.classification.join("/")}, ${context.size}`;
}
