/**
 * Coordinator side of the swarm design: plan focused assignments, synthesize the
 * investigators' reports, and never invent locations. Every cited file must be
 * in the diff and every line must be an added line — validated against the patch.
 */
import type {
  CodegraphChangedFile,
  CodegraphReport,
  Hypothesis,
  HypothesisDismissal,
  HypothesisDownstream,
  HypothesisMechanism,
  HypothesisSeverity,
  SwarmAgentReport,
  SwarmAssignment,
} from "./types.ts";
import { HYPOTHESIS_MECHANISMS, HYPOTHESIS_SEVERITIES } from "./types.ts";
import { parsePatches, renderChangedPatches, type ParsedPatch } from "./patch.ts";
import { hypothesisId, sortHypotheses } from "./rules.ts";
import {
  coordinatorPlanUser,
  coordinatorSystem,
  coordinatorSynthesizeUser,
} from "./prompts.ts";
import type { BetabotModelClient } from "./model.ts";

const MAX_DIFF_CHARS = 24_000;

export function renderGraphEvidence(report: CodegraphReport): string {
  const blocks: string[] = [];
  for (const file of report.files.slice(0, 30)) {
    const lines: string[] = [`#### ${file.path} (${file.status}, ${file.language})`];
    if (file.symbols.length > 0) {
      lines.push(
        `symbols: ${file.symbols
          .slice(0, 12)
          .map((symbol) => `${symbol.qualifiedName}:${symbol.line}`)
          .join(", ")}`,
      );
    }
    if (file.callers.length > 0) {
      lines.push(`callers outside the diff: ${file.callers.map((caller) => `${caller.file}#${caller.symbol} → ${caller.via}`).join(", ")}`);
    }
    if (file.importedBy.length > 0) lines.push(`imported by: ${file.importedBy.join(", ")}`);
    if (file.callees.length > 0) lines.push(`calls into: ${file.callees.map((callee) => `${callee.file}#${callee.symbol}`).join(", ")}`);
    if (file.tests.length > 0) lines.push(`likely tests: ${file.tests.join(", ")}`);
    blocks.push(lines.join("\n"));
  }
  return blocks.join("\n\n");
}

export interface ModelHypothesis {
  file: string;
  line: number;
  snippet: string;
  mechanism: HypothesisMechanism;
  severity: HypothesisSeverity;
  confidence: number;
  change: string;
  why: string;
  question: string;
  downstream: HypothesisDownstream[];
  leadId?: string;
  priority?: number;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function parseJson(text: string): Record<string, unknown> | undefined {
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

export function parseModelHypotheses(
  text: string,
  input: { files: CodegraphChangedFile[]; patches: Map<string, ParsedPatch>; maxHypotheses: number },
): { hypotheses: ModelHypothesis[]; dropped: number } {
  const parsed = parseJson(text);
  // Accept the legacy `suspicions` key so a model answering from habit still counts.
  const raw = Array.isArray(parsed?.hypotheses) ? parsed!.hypotheses : Array.isArray(parsed?.suspicions) ? parsed!.suspicions : [];
  const changed = new Set(input.files.map((file) => file.path));
  const out: ModelHypothesis[] = [];
  let dropped = 0;
  for (const entry of raw.slice(0, input.maxHypotheses * 2)) {
    if (!entry || typeof entry !== "object") {
      dropped += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const file = asString(record.file);
    const line = typeof record.line === "number" && Number.isFinite(record.line) ? Math.floor(record.line) : undefined;
    const mechanism = HYPOTHESIS_MECHANISMS.includes(record.mechanism as HypothesisMechanism)
      ? (record.mechanism as HypothesisMechanism)
      : undefined;
    const change = asString(record.change);
    const why = asString(record.why);
    const question = asString(record.question);
    if (!file || line === undefined || line <= 0 || !mechanism || !change || !why || !question) {
      dropped += 1;
      continue;
    }
    if (!changed.has(file)) {
      dropped += 1;
      continue;
    }
    const patch = input.patches.get(file);
    let effectiveLine = line;
    if (patch && patch.added.size > 0 && !patch.added.has(line)) {
      // The model must cite an added line; a typo one or two lines off is still
      // useful context, so snap to the nearest added line.
      const nearest = [...patch.added.keys()].find((candidate) => Math.abs(candidate - line) <= 2);
      if (nearest === undefined) {
        dropped += 1;
        continue;
      }
      effectiveLine = nearest;
    }
    const snippet = asString(record.snippet) ?? patch?.added.get(effectiveLine) ?? "";
    const severity = HYPOTHESIS_SEVERITIES.includes(record.severity as HypothesisSeverity)
      ? (record.severity as HypothesisSeverity)
      : "medium";
    const confidence =
      typeof record.confidence === "number" && record.confidence >= 0 && record.confidence <= 1
        ? record.confidence
        : 0.5;
    const downstream: HypothesisDownstream[] = Array.isArray(record.downstream)
      ? record.downstream
          .slice(0, 8)
          .map((ref) => (ref && typeof ref === "object" ? (ref as Record<string, unknown>) : undefined))
          .filter((ref): ref is Record<string, unknown> => ref !== undefined)
          .map((ref) => ({
            symbol: asString(ref.symbol) ?? "",
            file: asString(ref.file) ?? "",
            relation: ref.relation === "imports" ? ("imports" as const) : ("calls" as const),
          }))
          .filter((ref) => ref.file.length > 0)
      : [];
    const priority =
      typeof record.priority === "number" && Number.isFinite(record.priority) && record.priority >= 1
        ? Math.floor(record.priority)
        : undefined;
    out.push({
      file,
      line: effectiveLine,
      snippet,
      mechanism,
      severity,
      confidence,
      change,
      why,
      question,
      downstream,
      leadId: asString(record.leadId),
      priority,
    });
    if (out.length >= input.maxHypotheses) break;
  }
  return { hypotheses: out, dropped };
}

export function toHypothesis(entry: ModelHypothesis, lead?: Hypothesis): Hypothesis {
  return {
    id: hypothesisId({ file: entry.file, line: entry.line, mechanism: entry.mechanism }),
    ruleId: lead?.ruleId ?? "coordinator",
    source: "model",
    mechanism: entry.mechanism,
    severity: entry.severity,
    confidence: entry.confidence,
    file: entry.file,
    line: entry.line,
    snippet: entry.snippet.slice(0, 300),
    symbol: lead?.symbol,
    change: entry.change,
    why: entry.why,
    question: entry.question,
    downstream: entry.downstream.length > 0 ? entry.downstream : (lead?.downstream ?? []),
    priority: entry.priority,
  };
}

export function matchLead(entry: { file: string; line: number; mechanism: HypothesisMechanism; leadId?: string }, leads: Hypothesis[]): Hypothesis | undefined {
  if (entry.leadId) {
    const byId = leads.find((lead) => lead.id === entry.leadId);
    if (byId) return byId;
  }
  return leads.find(
    (lead) =>
      lead.file === entry.file &&
      lead.mechanism === entry.mechanism &&
      Math.abs(lead.line - entry.line) <= 2,
  );
}

/**
 * Deterministic merge of the three producers: leads, swarm findings and the
 * coordinator's synthesis. Synthesis wins, swarm evidence is never lost, and
 * leads survive unless a model finding covers them.
 */
function attachLead(hypothesis: Hypothesis, leads: Hypothesis[]): Hypothesis {
  const lead = matchLead(hypothesis, leads);
  if (!lead) return hypothesis;
  return {
    ...hypothesis,
    ruleId: lead.ruleId,
    symbol: hypothesis.symbol ?? lead.symbol,
    downstream: hypothesis.downstream.length > 0 ? hypothesis.downstream : lead.downstream,
  };
}

export function mergeHypotheses(input: {
  leads: Hypothesis[];
  swarm: Hypothesis[];
  synthesis: Hypothesis[];
  maxHypotheses: number;
}): Hypothesis[] {
  const merged = new Map<string, Hypothesis>();
  const key = (hypothesis: Hypothesis) => `${hypothesis.file}:${hypothesis.line}:${hypothesis.mechanism}`;
  for (const hypothesis of input.swarm) merged.set(key(hypothesis), attachLead(hypothesis, input.leads));
  for (const hypothesis of input.synthesis) merged.set(key(hypothesis), attachLead(hypothesis, input.leads));

  const covered = new Set<string>();
  for (const hypothesis of [...input.swarm, ...input.synthesis]) {
    const lead = matchLead(hypothesis, input.leads);
    if (lead) covered.add(lead.id);
  }
  for (const lead of input.leads) {
    if (covered.has(lead.id) || merged.has(key(lead))) continue;
    merged.set(key(lead), lead);
  }
  const { hypotheses } = dedupeHypotheses([...merged.values()]);
  return sortHypotheses(hypotheses).slice(0, input.maxHypotheses);
}

// ---------------------------------------------------------------------------
// Duplicate detection — one bug appears once, even when producers phrase it
// differently, cite a nearby line or name a different mechanism.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "is", "are", "was", "were", "be", "in", "on", "for",
  "with", "that", "this", "it", "its", "by", "as", "at", "from", "can", "now", "not", "no", "so",
  "if", "then", "when", "will", "would", "may", "might", "any", "every", "all", "more", "less",
  "than", "into", "out", "up", "down", "over", "after", "before", "same", "new", "old", "change",
  "changed", "changes", "instead", "rather", "only", "still", "also",
]);

export function normalizedTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );
}

/**
 * Overlap coefficient: shared tokens over the smaller set. A short suspicion
 * that is contained in a longer description of the same defect still matches.
 */
export function textOverlap(a: Hypothesis, b: Hypothesis): number {
  const left = normalizedTokens(`${a.change} ${a.why} ${a.symbol ?? ""}`);
  const right = normalizedTokens(`${b.change} ${b.why} ${b.symbol ?? ""}`);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Conservative duplicate rule: same file, then location/mechanism/overlap. */
export function sameFinding(a: Hypothesis, b: Hypothesis): boolean {
  if (a.file !== b.file) return false;
  if (a.line === b.line) {
    if (a.mechanism === b.mechanism) return true;
    // Same line but different mechanisms: only collapse when the wording
    // overlaps, so genuinely different defects on one line stay visible.
    return textOverlap(a, b) >= 0.45;
  }
  if (Math.abs(a.line - b.line) <= 3) {
    if (a.mechanism === b.mechanism) return true;
    return textOverlap(a, b) >= 0.6;
  }
  return Boolean(a.symbol && b.symbol && a.symbol === b.symbol && a.mechanism === b.mechanism);
}

const SEVERITY_ORDER: Record<HypothesisSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

function preferred(a: Hypothesis, b: Hypothesis): Hypothesis {
  const priorityA = a.priority ?? Number.MAX_SAFE_INTEGER;
  const priorityB = b.priority ?? Number.MAX_SAFE_INTEGER;
  if (priorityA !== priorityB) return priorityA < priorityB ? a : b;
  const severityA = SEVERITY_ORDER[a.severity] ?? 0;
  const severityB = SEVERITY_ORDER[b.severity] ?? 0;
  if (severityA !== severityB) return severityA > severityB ? a : b;
  if (a.confidence !== b.confidence) return a.confidence >= b.confidence ? a : b;
  if (a.source !== b.source) return a.source === "model" ? a : b;
  return a;
}

function mergePair(winner: Hypothesis, loser: Hypothesis): Hypothesis {
  const downstream = new Map<string, HypothesisDownstream>();
  for (const ref of [...winner.downstream, ...loser.downstream]) {
    downstream.set(`${ref.relation}:${ref.file}#${ref.symbol}`, ref);
  }
  const inheritRule =
    winner.source === "model" && loser.source === "rule" && (winner.ruleId === "coordinator" || winner.ruleId === "master");
  return {
    ...winner,
    ruleId: inheritRule ? loser.ruleId : winner.ruleId,
    symbol: winner.symbol ?? loser.symbol,
    downstream: [...downstream.values()].slice(0, 12),
  };
}

export function dedupeHypotheses(hypotheses: Hypothesis[]): { hypotheses: Hypothesis[]; deduped: number } {
  const kept: Hypothesis[] = [];
  let deduped = 0;
  for (const hypothesis of hypotheses) {
    const match = kept.findIndex((existing) => sameFinding(existing, hypothesis));
    if (match === -1) {
      kept.push(hypothesis);
      continue;
    }
    const winner = preferred(kept[match], hypothesis);
    const loser = winner === kept[match] ? hypothesis : kept[match];
    kept[match] = mergePair(winner, loser);
    deduped += 1;
  }
  return { hypotheses: kept, deduped };
}

// ---------------------------------------------------------------------------
// Coordinator call 1 — plan assignments
// ---------------------------------------------------------------------------

export interface AssignmentPlannerInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  body?: string;
  headSha: string;
  report: CodegraphReport;
  files: CodegraphChangedFile[];
  leads: Hypothesis[];
  dismissals: HypothesisDismissal[];
  maxAgents: number;
  client: BetabotModelClient;
  signal?: AbortSignal;
  cacheKey?: string;
}

export interface AssignmentPlannerResult {
  assignments: SwarmAssignment[];
  dropped: number;
  warnings: string[];
}

export function parseAssignments(
  text: string,
  input: { changedFiles: string[]; leads: Hypothesis[]; maxAgents: number },
): { assignments: SwarmAssignment[]; dropped: number } {
  const parsed = parseJson(text);
  const raw = Array.isArray(parsed?.assignments) ? parsed!.assignments : [];
  const changed = new Set(input.changedFiles);
  const leadIds = new Set(input.leads.map((lead) => lead.id));
  const out: SwarmAssignment[] = [];
  let dropped = 0;
  for (const entry of raw.slice(0, input.maxAgents * 2)) {
    if (!entry || typeof entry !== "object") {
      dropped += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const focus = asString(record.focus);
    const files = Array.isArray(record.files)
      ? [...new Set(record.files.map((file) => asString(file)).filter((file): file is string => file !== undefined))].filter((file) => changed.has(file))
      : [];
    const leads = Array.isArray(record.leads)
      ? [...new Set(record.leads.map((lead) => asString(lead)).filter((lead): lead is string => lead !== undefined))].filter((lead) => leadIds.has(lead))
      : [];
    if (!focus || files.length === 0) {
      dropped += 1;
      continue;
    }
    const kind = record.kind === "lead" || leads.length > 0 ? "lead" : "sweep";
    out.push({
      id: asString(record.id) ?? `a${out.length + 1}`,
      kind,
      files,
      leads,
      focus,
    });
    if (out.length >= input.maxAgents) break;
  }
  return { assignments: out, dropped };
}

export async function runAssignmentPlanner(input: AssignmentPlannerInput): Promise<AssignmentPlannerResult> {
  const diff = renderChangedPatches(input.files, MAX_DIFF_CHARS);
  const completion = await input.client.complete({
    system: coordinatorSystem(),
    user: coordinatorPlanUser({
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      title: input.title,
      body: input.body,
      headSha: input.headSha,
      diff,
      graph: renderGraphEvidence(input.report),
      leads: input.leads,
      dismissals: input.dismissals,
      maxAgents: input.maxAgents,
    }),
    signal: input.signal,
    cacheKey: input.cacheKey,
  });
  const { assignments, dropped } = parseAssignments(completion.text, {
    changedFiles: input.files.filter((file) => file.status !== "removed").map((file) => file.path),
    leads: input.leads,
    maxAgents: input.maxAgents,
  });
  return {
    assignments,
    dropped,
    warnings: dropped > 0 ? [`dropped ${dropped} invalid assignment(s) from the coordinator plan`] : [],
  };
}

// ---------------------------------------------------------------------------
// Coordinator call 2 — synthesize
// ---------------------------------------------------------------------------

export interface SynthesisInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  leads: Hypothesis[];
  reports: SwarmAgentReport[];
  dismissals: HypothesisDismissal[];
  maxHypotheses: number;
  files: CodegraphChangedFile[];
  patches: Map<string, ParsedPatch>;
  client: BetabotModelClient;
  signal?: AbortSignal;
  cacheKey?: string;
}

export interface SynthesisResult {
  entries: ModelHypothesis[];
  dropped: number;
  warnings: string[];
}

export async function runSynthesis(input: SynthesisInput): Promise<SynthesisResult> {
  const completion = await input.client.complete({
    system: coordinatorSystem(),
    user: coordinatorSynthesizeUser({
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      title: input.title,
      headSha: input.headSha,
      diff: renderChangedPatches(input.files, MAX_DIFF_CHARS),
      leads: input.leads,
      reports: input.reports,
      dismissals: input.dismissals,
      maxHypotheses: input.maxHypotheses,
    }),
    signal: input.signal,
    cacheKey: input.cacheKey,
  });
  const { hypotheses, dropped } = parseModelHypotheses(completion.text, {
    files: input.files,
    patches: input.patches,
    maxHypotheses: input.maxHypotheses,
  });
  return {
    entries: hypotheses,
    dropped,
    warnings: dropped > 0 ? [`dropped ${dropped} synthesis hypothesis(es) that cited no changed line`] : [],
  };
}

// ---------------------------------------------------------------------------

export function patchesFor(files: CodegraphChangedFile[]): Map<string, ParsedPatch> {
  return parsePatches(files);
}
