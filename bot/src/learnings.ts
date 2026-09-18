/**
 * Learnings: dismissals stored in `repository_learnings`. A dismissal is keyed
 * by the hypothesis fingerprint (file + mechanism + normalized change), so a
 * materially different change still gets reported.
 */
import type { Hypothesis, HypothesisDismissal } from "./types.ts";
import { hypothesisId } from "./rules.ts";

export interface LearningRowInput {
  findingKey: string | null;
  text: string;
  path: string | null;
}

export function dismissalOf(row: LearningRowInput): HypothesisDismissal | undefined {
  if (!row.findingKey) return undefined;
  return {
    fingerprint: row.findingKey,
    reason: row.text,
    path: row.path ?? undefined,
  };
}

export function applyDismissals(
  hypotheses: Hypothesis[],
  dismissals: HypothesisDismissal[],
): { kept: Hypothesis[]; suppressed: Hypothesis[] } {
  if (dismissals.length === 0) return { kept: hypotheses, suppressed: [] };
  const dismissed = new Set(dismissals.map((entry) => entry.fingerprint));
  const kept: Hypothesis[] = [];
  const suppressed: Hypothesis[] = [];
  for (const hypothesis of hypotheses) {
    const fingerprint = hypothesisId({
      file: hypothesis.file,
      line: hypothesis.line,
      mechanism: hypothesis.mechanism,
    });
    if (dismissed.has(fingerprint)) suppressed.push(hypothesis);
    else kept.push(hypothesis);
  }
  return { kept, suppressed };
}

/** Prompt block telling the models what the repository already dismissed. */
export function renderDismissals(dismissals: HypothesisDismissal[], limit = 24): string {
  if (dismissals.length === 0) return "";
  const lines = dismissals
    .slice(0, limit)
    .map((entry) => `- \`${entry.fingerprint}\`${entry.path ? ` (${entry.path})` : ""} — ${entry.reason}`);
  return [
    "## Repository learnings",
    "The team previously dismissed these hypotheses. Do not report them again unless the change is materially different:",
    ...lines,
  ].join("\n");
}
