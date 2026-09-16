import { z } from "zod";
import type { Candidate, JudgeDecision, PRContext } from "./types";
import type { ModelRouter } from "./models";
import { extractJson, renderLearnings, type Logger } from "./util";

const decisionSchema = z.object({
  candidateId: z.string().min(1),
  verdict: z
    .string()
    .transform((value) => value.trim().toUpperCase())
    .pipe(z.enum(["PROVE", "STATIC_ONLY", "DISCARD"]).catch("STATIC_ONLY")),
  reason: z.string().max(300).catch("no reason provided"),
  priority: z.coerce.number().int().min(1).max(10).catch(5),
});

const judgeSchema = z.object({ decisions: z.array(decisionSchema).min(1) });

const SYSTEM = [
  "You are Terra, the synthesis judge in an autonomous code review pipeline.",
  "Decide which candidate defects deserve execution-based proof.",
  "PROVE a candidate when it materially affects correctness, security, data, or user flows and the provided evidence is concrete.",
  "STATIC_ONLY for real but low-value or purely stylistic claims. DISCARD for duplicates or noise.",
  "Priority 1 is the most important. You must return exactly one decision per candidate id.",
  'Return JSON only: {"decisions":[{"candidateId":"...","verdict":"PROVE","reason":"...","priority":1}]}',
].join(" ");

export interface JudgeReport {
  decisions: JudgeDecision[];
  source: "terra" | "fallback";
}

export function fallbackJudge(candidates: Candidate[], maxToProve: number): JudgeDecision[] {
  const ordered = [...candidates].sort((a, b) => b.score - a.score);
  let proved = 0;
  return ordered.map((candidate) => {
    // Funding is a budget decision, never a provability guess: the prover is
    // responsible for producing a reproduction, not the judge (3.4).
    const funded = candidate.severity !== "info" && proved < maxToProve;
    if (funded) proved++;
    return {
      candidateId: candidate.id,
      verdict: funded ? ("PROVE" as const) : ("STATIC_ONLY" as const),
      reason: funded ? "Selected for execution-based proof" : "Below the proof budget for this run",
      priority: funded ? proved : 99,
    };
  });
}

export async function judgeCandidates(
  candidates: Candidate[],
  context: PRContext,
  models: ModelRouter,
  logger: Logger,
  maxToProve: number,
): Promise<JudgeReport> {
  if (candidates.length === 0) return { decisions: [], source: "fallback" };
  try {
    const list = candidates
      .map(
        (candidate) =>
          `- id=${candidate.id} severity=${candidate.severity} confidence=${candidate.confidence.toFixed(2)} file=${candidate.file ?? "n/a"}:${candidate.line ?? "?"} experiment=${(candidate.suggestedExperiment ?? "none").slice(0, 200)} claim=${candidate.claim.slice(0, 260)}`,
      )
      .join("\n");
    const learnings = renderLearnings(context.learnings);
    const response = await models.complete({
      role: "terra",
      kind: "judge",
      system: SYSTEM,
      user: [
        `PR: ${context.title}`,
        learnings ? `Repository learnings (respect these when judging):\n${learnings}` : "",
        `Candidates:\n${list}`,
        "Return the JSON decision now.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      expectJson: true,
      label: "terra-judge",
    });
    const parsed = judgeSchema.safeParse(extractJson(response.text));
    if (!parsed.success) throw new Error(`invalid judge JSON: ${parsed.error.message.slice(0, 200)}`);
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const seen = new Set<string>();
    const decisions: JudgeDecision[] = [];
    for (const decision of parsed.data.decisions) {
      if (!byId.has(decision.candidateId) || seen.has(decision.candidateId)) continue;
      seen.add(decision.candidateId);
      decisions.push(decision);
    }
    for (const candidate of candidates) {
      if (seen.has(candidate.id)) continue;
      decisions.push({
        candidateId: candidate.id,
        verdict: "STATIC_ONLY",
        reason: "the judge did not return a decision for this candidate",
        priority: 99,
      });
    }

    const ordered = decisions.sort((a, b) => a.priority - b.priority || a.candidateId.localeCompare(b.candidateId));
    let proved = 0;
    for (const decision of ordered) {
      const candidate = byId.get(decision.candidateId);
      if (!candidate) continue;
      const detectorCritical =
        candidate.source === "detector" &&
        Boolean(candidate.check) &&
        (candidate.severity === "critical" || candidate.severity === "high");
      if (detectorCritical && decision.verdict !== "PROVE") {
        decision.verdict = "PROVE";
        decision.reason = `${decision.reason} (upgraded: deterministic, executable proof available)`;
      }
      // The only permitted downgrade is the proof budget. Whether a candidate
      // is provable is the prover's call, never the judge's or the engine's
      // (3.4) — the 3.3 "No executable proof available" gate silently disabled
      // the autonomous loop on every logic bug.
      if (decision.verdict === "PROVE" && proved >= maxToProve) {
        decision.verdict = "STATIC_ONLY";
        decision.reason = `${decision.reason} (downgraded: proof budget)`;
        decision.priority = 90;
        continue;
      }
      if (decision.verdict === "PROVE") {
        proved++;
        decision.priority = proved;
      }
    }
    return { decisions: ordered, source: "terra" };
  } catch (error) {
    logger.warn("judge fell back to deterministic policy", { error: error instanceof Error ? error.message : String(error) });
    return { decisions: fallbackJudge(candidates, maxToProve), source: "fallback" };
  }
}
