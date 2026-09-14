import type {
  CortadoResult,
  CortadoSummary,
  FinalReview,
  Finding,
  JudgeDecision,
  MergedCandidate,
  PipelineStage,
  PRContext,
  ProofResult,
  RepairExitState,
  RepairResult,
  StageEvent,
  UsageSnapshot,
  VerificationReport,
} from "./types";
import { formatMs, truncate } from "./util/text";

export interface AssemblyInput {
  runId: string;
  input: { id?: string; title: string };
  context: PRContext | null;
  candidates: MergedCandidate[];
  decisions: JudgeDecision[];
  proofs: ProofResult[];
  repairs: RepairResult[];
  verifications: Record<string, VerificationReport>;
  reviews: FinalReview[];
  events: StageEvent[];
  timings: Partial<Record<PipelineStage, number>>;
  usage: UsageSnapshot;
  dryRun: boolean;
  startedAt: number;
  endedAt: number;
  status: "completed" | "failed";
  error?: string;
}

export function buildFindings(
  candidates: MergedCandidate[],
  proofs: ProofResult[],
  repairs: RepairResult[],
  verifications: Record<string, VerificationReport>,
): Finding[] {
  const proofById = new Map(proofs.map((proof) => [proof.candidateId, proof]));
  const repairById = new Map(repairs.map((repair) => [repair.candidateId, repair]));
  return candidates
    .filter((candidate) => {
      const proof = proofById.get(candidate.id);
      return proof && (proof.status === "confirmed" || proof.status === "likely");
    })
    .map((candidate) => {
      const proof = proofById.get(candidate.id)!;
      const repair = repairById.get(candidate.id);
      return {
        id: `f_${candidate.id}`,
        candidateId: candidate.id,
        title: truncate(candidate.claim, 140),
        severity: candidate.severity,
        confidence: candidate.confidence,
        file: candidate.file,
        evidence: candidate.evidence,
        proof,
        repair,
        verification: repair ? verifications[repair.candidateId] : undefined,
      } satisfies Finding;
    })
    .sort((a, b) => severityWeight(b.severity) - severityWeight(a.severity) || b.confidence - a.confidence);
}

function severityWeight(severity: string): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[severity] ?? 0;
}

export function assembleResult(assembly: AssemblyInput): CortadoResult {
  const exitStates: Record<RepairExitState, number> = {
    VERIFIED: 0,
    UNRESOLVED: 0,
    UNSAFE: 0,
    BUDGET_EXHAUSTED: 0,
  };
  for (const repair of assembly.repairs) exitStates[repair.exit]++;

  const findings = buildFindings(assembly.candidates, assembly.proofs, assembly.repairs, assembly.verifications);
  for (const finding of findings) {
    finding.review = assembly.reviews.find((review) => review.candidateId === finding.candidateId);
  }

  const summary: CortadoSummary = {
    issuesFound: assembly.candidates.length,
    issuesConfirmed: assembly.proofs.filter((proof) => proof.status === "confirmed").length,
    issuesFixed: assembly.repairs.filter((repair) => repair.exit === "VERIFIED").length,
    issuesVerified: findings.filter((finding) => finding.repair?.exit === "VERIFIED" && finding.verification?.passed).length,
    issuesStaticOnly: assembly.decisions.filter((decision) => decision.verdict === "STATIC_ONLY").length,
    issuesDiscarded: assembly.decisions.filter((decision) => decision.verdict === "DISCARD").length,
    durationMs: assembly.endedAt - assembly.startedAt,
    modelCalls: assembly.usage.calls,
    credits: assembly.usage.credits,
    exitStates,
  };

  const partial: Omit<CortadoResult, "markdown"> = {
    runId: assembly.runId,
    status: assembly.status,
    error: assembly.error,
    dryRun: assembly.dryRun,
    pr: {
      id: assembly.input.id ?? assembly.runId,
      title: assembly.input.title,
      classification: assembly.context?.classification ?? ["UNKNOWN"],
      size: assembly.context?.size ?? "normal",
    },
    context: assembly.context,
    candidates: assembly.candidates,
    decisions: assembly.decisions,
    proofs: assembly.proofs,
    repairs: assembly.repairs,
    findings,
    reviews: assembly.reviews,
    events: assembly.events,
    timings: assembly.timings,
    usage: assembly.usage,
    summary,
  };

  return { ...partial, markdown: formatResultMarkdown(partial) };
}

export function formatResultMarkdown(result: Omit<CortadoResult, "markdown">): string {
  const lines: string[] = [];
  lines.push("# Cortado Review");
  lines.push("");
  if (result.status === "failed") {
    lines.push(`Run failed: ${result.error ?? "unknown error"}`);
    return lines.join("\n");
  }

  const { summary } = result;
  lines.push(
    `${summary.issuesFound} issue(s) found · ${summary.issuesConfirmed} confirmed · ${summary.issuesFixed} fixed · ${summary.issuesVerified} verified · ${formatMs(summary.durationMs)}`,
  );
  lines.push("");
  lines.push(
    `Classification: ${result.pr.classification.join(" / ")} · Size: ${result.pr.size} · Model calls: ${summary.modelCalls} · Credits: ${summary.credits}`,
  );
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("No confirmed issues. Nothing to fix.");
  }

  for (const finding of result.findings) {
    const fixed = finding.repair?.exit === "VERIFIED" && finding.verification?.passed;
    const tag = fixed
      ? "FIXED"
      : finding.repair?.exit === "UNSAFE"
        ? "UNSAFE"
        : finding.proof.status === "confirmed"
          ? "CONFIRMED"
          : "UNPROVEN";
    lines.push(`## [${tag}] ${finding.severity.toUpperCase()} — ${finding.title}`);
    if (finding.file) lines.push(`File: \`${finding.file}\``);
    lines.push(`Confidence: ${Math.round(finding.confidence * 100)}%`);
    lines.push(`Evidence: ${finding.evidence.join(", ")}`);
    if (finding.proof.reproduction) {
      lines.push("Reproduction:");
      lines.push("```");
      lines.push(truncate(finding.proof.reproduction, 800));
      lines.push("```");
    }
    if (finding.repair) {
      lines.push(`Repair: ${finding.repair.exit} — ${finding.repair.reason}`);
    }
    if (finding.verification) {
      const steps = finding.verification.steps
        .filter((step) => !step.skipped)
        .map((step) => `${step.kind}:${step.passed ? "pass" : "fail"}`)
        .join(" · ");
      lines.push(`Verification: ${finding.verification.passed ? "passed" : "failed"} (${steps || "no steps"})`);
    }
    if (finding.review) {
      lines.push(
        `Astra: ${finding.review.validity} / fix ${finding.review.fixCorrectness} / risk ${finding.review.risk} / ${finding.review.approval} (${Math.round(finding.review.confidence * 100)}%)`,
      );
      lines.push(finding.review.summary);
    }
    lines.push("");
  }

  const staticOnly = result.decisions.filter((decision) => decision.verdict === "STATIC_ONLY");
  if (staticOnly.length > 0) {
    lines.push(`## Static only (${staticOnly.length})`);
    for (const decision of staticOnly) {
      const candidate = result.candidates.find((item) => item.id === decision.hypothesisId);
      lines.push(`- ${candidate ? candidate.severity.toUpperCase() : "?"} — ${candidate?.claim ?? decision.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd() + "\n";
}

export function summarizeExitStates(repairs: RepairResult[]): Record<RepairExitState, number> {
  const out: Record<RepairExitState, number> = { VERIFIED: 0, UNRESOLVED: 0, UNSAFE: 0, BUDGET_EXHAUSTED: 0 };
  for (const repair of repairs) out[repair.exit]++;
  return out;
}
