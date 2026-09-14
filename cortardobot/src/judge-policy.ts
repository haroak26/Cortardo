import { severityRank, type CortadoConfig } from "./config";
import type { JudgeDecision, MergedCandidate, PRContext } from "./types";
import { detectorById } from "./agents/detectors";

export function maxProveFor(context: PRContext, config: CortadoConfig): number {
  return context.size === "complex" ? config.judge.maxToProveComplex : config.judge.maxToProve;
}

export function isExecutionProvable(candidate: MergedCandidate): boolean {
  const ruleTag = candidate.tags.find((tag) => tag.startsWith("rule:"));
  if (!ruleTag) return true;
  const detector = detectorById(ruleTag.slice("rule:".length));
  if (!detector) return true;
  return detector.provable !== false;
}

export function deterministicJudge(
  candidates: MergedCandidate[],
  context: PRContext,
  config: CortadoConfig,
  options: { probeCommands: boolean } = { probeCommands: false },
): JudgeDecision[] {
  const maxToProve = maxProveFor(context, config);
  const sorted = [...candidates].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  let proved = 0;
  return sorted.map((candidate) => {
    const meetsBar =
      severityRank(candidate.severity) >= severityRank(config.judge.minSeverity) &&
      candidate.confidence >= config.judge.minConfidence;
    if (meetsBar && isExecutionProvable(candidate) && proved < maxToProve) {
      proved++;
      return {
        hypothesisId: candidate.id,
        verdict: "PROVE" as const,
        reason: `${candidate.severity} candidate with ${Math.round(candidate.confidence * 100)}% confidence and ${candidate.occurrences} corroborating observation(s)`,
        priority: proved,
        reproductionCommand: options.probeCommands ? `cortado-probe ${candidate.id}` : undefined,
      };
    }
    if (meetsBar && !isExecutionProvable(candidate)) {
      return {
        hypothesisId: candidate.id,
        verdict: "STATIC_ONLY" as const,
        reason: "Real but not provable by execution; reported as static evidence",
        priority: proved + 1,
      };
    }
    if (severityRank(candidate.severity) >= severityRank("low") && candidate.confidence >= 0.4) {
      return {
        hypothesisId: candidate.id,
        verdict: "STATIC_ONLY" as const,
        reason: "Real signal, but not selected for execution-based proof",
        priority: proved + 1,
      };
    }
    return {
      hypothesisId: candidate.id,
      verdict: "DISCARD" as const,
      reason: "Low confidence or low value after merging",
      priority: 99,
    };
  });
}
