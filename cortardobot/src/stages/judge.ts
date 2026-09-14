import { severityRank, type CortadoConfig } from "../config";
import type { JudgeDecision, MergedCandidate, PRContext } from "../types";
import { extractJson } from "../util/json";
import { judgeSchema } from "../agents/contracts";
import { judgeSystemPrompt, judgeUserPrompt } from "../agents/prompts";
import { isExecutionProvable, maxProveFor, deterministicJudge } from "../judge-policy";

export { deterministicJudge, maxProveFor } from "../judge-policy";
import type { Logger } from "../util/logger";
import type { ModelRouter } from "../models/router";

export interface JudgeReport {
  decisions: JudgeDecision[];
  source: "terra" | "deterministic";
  error?: string;
}

export async function judgeCandidates(
  candidates: MergedCandidate[],
  context: PRContext,
  models: ModelRouter,
  config: CortadoConfig,
  logger: Logger,
): Promise<JudgeReport> {
  if (candidates.length === 0) {
    return { decisions: [], source: "deterministic" };
  }
  try {
    const response = await models.complete({
      role: "terra",
      kind: "judge",
      system: judgeSystemPrompt(),
      user: judgeUserPrompt(candidates, context),
      expectJson: true,
      context: {
        candidates,
        maxToProve: maxProveFor(context, config),
        minConfidence: config.judge.minConfidence,
        minSeverity: config.judge.minSeverity,
      },
      label: "terra-judge",
    });
    const parsed = judgeSchema.parse(extractJson(response.text));
    const decisions: JudgeDecision[] = parsed.decisions.map((decision) => ({
      hypothesisId: decision.hypothesisId,
      verdict: decision.verdict,
      reason: decision.reason,
      priority: decision.priority ?? 1,
      reproductionCommand: decision.reproductionCommand,
    }));
    return {
      decisions: enforceJudgePolicy(decisions, candidates, context, config, models.dryRun),
      source: "terra",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("judge fell back to deterministic policy", { error: message });
    return {
      decisions: deterministicJudge(candidates, context, config, { probeCommands: models.dryRun }),
      source: "deterministic",
      error: message,
    };
  }
}

export function enforceJudgePolicy(
  decisions: JudgeDecision[],
  candidates: MergedCandidate[],
  context: PRContext,
  config: CortadoConfig,
  probeCommands: boolean,
): JudgeDecision[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const seen = new Set<string>();
  const merged: JudgeDecision[] = [];

  for (const decision of decisions) {
    if (!byId.has(decision.hypothesisId) || seen.has(decision.hypothesisId)) continue;
    seen.add(decision.hypothesisId);
    merged.push({
      hypothesisId: decision.hypothesisId,
      verdict: decision.verdict,
      reason: decision.reason,
      priority: decision.priority ?? merged.length + 1,
      reproductionCommand: decision.reproductionCommand,
    });
  }

  for (const candidate of candidates) {
    if (seen.has(candidate.id)) continue;
    merged.push({
      hypothesisId: candidate.id,
      verdict: "DISCARD",
      reason: "No decision returned by the judge",
      priority: 99,
    });
  }

  const maxToProve = maxProveFor(context, config);
  let proved = 0;
  const ordered = [...merged].sort(
    (a, b) => a.priority - b.priority || a.hypothesisId.localeCompare(b.hypothesisId),
  );
  for (const decision of ordered) {
    const candidate = byId.get(decision.hypothesisId);
    if (!candidate) continue;
    if (decision.verdict !== "PROVE") continue;
    const meetsBar =
      severityRank(candidate.severity) >= severityRank(config.judge.minSeverity) &&
      candidate.confidence >= config.judge.minConfidence;
    if (!meetsBar || proved >= maxToProve || !isExecutionProvable(candidate)) {
      decision.verdict = "STATIC_ONLY";
      decision.reason = !isExecutionProvable(candidate)
        ? "Real but not provable by execution; reported as static evidence"
        : `${decision.reason} (downgraded: proof budget or confidence bar)`;
      decision.reproductionCommand = undefined;
      continue;
    }
    proved++;
    decision.priority = proved;
    if (!decision.reproductionCommand && probeCommands) {
      decision.reproductionCommand = `cortado-probe ${decision.hypothesisId}`;
    }
  }

  return merged.sort((a, b) => a.priority - b.priority || a.hypothesisId.localeCompare(b.hypothesisId));
}
