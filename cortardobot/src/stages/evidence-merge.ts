import { SEVERITY_WEIGHT, type CortadoConfig } from "../config";
import type { Hypothesis, MergedCandidate, PRContext, Severity } from "../types";
import { claimKey, clamp } from "../util/text";
import { maxSeverity } from "../config";

const GENERIC_CLAIM_RE =
  /^(consider|maybe|might want|it would be good|would be nice|add (some )?tests?|improve|refactor|clean ?up|document)/i;

export interface MergeStats {
  input: number;
  output: number;
  dropped: number;
}

export function mergeEvidence(
  hypotheses: Hypothesis[],
  context: PRContext,
  config: CortadoConfig,
): { candidates: MergedCandidate[]; stats: MergeStats } {
  const groups = new Map<string, Hypothesis[]>();
  let dropped = 0;

  for (const hypothesis of hypotheses) {
    const claim = hypothesis.claim.trim();
    if (claim.length < 8 || GENERIC_CLAIM_RE.test(claim)) {
      dropped++;
      continue;
    }
    if (hypothesis.evidence.length === 0 || hypothesis.confidence < 0.25) {
      dropped++;
      continue;
    }
    if (hypothesis.severity === "info" && hypothesis.confidence < 0.5) {
      dropped++;
      continue;
    }
    const symbolGroup = hypothesis.symbol ?? hypothesis.file ?? "repo";
    const key = `${symbolGroup}::${claimKey(claim)}`;
    const group = groups.get(key);
    if (group) group.push(hypothesis);
    else groups.set(key, [hypothesis]);
  }

  const candidates: MergedCandidate[] = [];
  for (const group of groups.values()) {
    const first = group[0];
    const severity = group.reduce<Severity>((acc, item) => maxSeverity(acc, item.severity), "info");
    const confidence = Math.max(...group.map((item) => item.confidence));
    const evidence = [...new Set(group.flatMap((item) => item.evidence))].slice(0, 8);
    const mergedFrom = group.map((item) => item.id);
    const occurrences = group.length;
    const tags = [...new Set(group.flatMap((item) => item.tags))];
    const file = first.file ?? evidence[0]?.split(":")[0];
    const score = scoreCandidate({
      severity,
      confidence,
      occurrences,
      file,
      evidence,
      context,
    });
    candidates.push({
      id: `c_${first.id.replace(/^h_/, "")}`,
      claim: first.claim,
      severity,
      confidence,
      evidence,
      suggestedExperiment: first.suggestedExperiment,
      file,
      symbol: first.symbol,
      tags,
      agent: first.agent,
      agentKind: first.agentKind,
      mergedFrom,
      occurrences,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const limited = candidates.slice(0, config.judge.maxCandidates);

  return {
    candidates: limited,
    stats: { input: hypotheses.length, output: limited.length, dropped: dropped + (candidates.length - limited.length) },
  };
}

function scoreCandidate(input: {
  severity: Severity;
  confidence: number;
  occurrences: number;
  file?: string;
  evidence: string[];
  context: PRContext;
}): number {
  const base = SEVERITY_WEIGHT[input.severity] * input.confidence;
  const agreement = 1 + 0.15 * Math.max(0, input.occurrences - 1);
  const proximity = intersectsChangedLines(input.evidence, input.context) ? 0.25 : 0;
  const file = input.file;
  const riskBonus = file
    ? Math.min(
        0.3,
        (input.context.riskSignals.filter((signal) => signal.weight >= 3).length * 0.1),
      )
    : 0;
  return Math.round((base * agreement + proximity + riskBonus) * 1000) / 1000;
}

function intersectsChangedLines(evidence: string[], context: PRContext): boolean {
  for (const entry of evidence) {
    const [path, lineText] = entry.split(":");
    const line = Number(lineText);
    if (!path || Number.isNaN(line)) continue;
    const file = context.files.find((candidate) => candidate.path === path);
    if (!file) continue;
    if (file.addedLines.some((added) => Math.abs(added.line - line) <= 2)) return true;
    if (file.removedLines.some((removed) => Math.abs(removed.line - line) <= 2)) return true;
  }
  return false;
}

export function clampScore(score: number): number {
  return clamp(score, 0, 100);
}
