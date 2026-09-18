/**
 * Deterministic hypothesis scan. Each rule reads the diff plus the code graph and
 * produces concrete, mechanism-level hypotheses — "this timeout change can fill
 * the pool", not "look for bugs". Rules never block anything; they seed the
 * master agent and stand on their own when the model is unavailable.
 */
import { createHash } from "node:crypto";
import type { CodeGraphSymbol } from "@shared/codegraph";
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import type {
  CodegraphChangedFile,
  CodegraphFileGraph,
  CodegraphReport,
  HypothesisDownstream,
  HypothesisMechanism,
  HypothesisSeverity,
  Hypothesis,
} from "./types.ts";
import { parsePatch, type ParsedPatch } from "./patch.ts";

export const SEVERITY_RANK: Record<HypothesisSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export function sortHypotheses(hypotheses: Hypothesis[]): Hypothesis[] {
  return [...hypotheses].sort(
    (a, b) =>
      (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER) ||
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] ||
      b.confidence - a.confidence ||
      a.file.localeCompare(b.file) ||
      a.line - b.line,
  );
}

/**
 * Stable dismissal fingerprint: file + added line + mechanism. Rules and the
 * model both cite the same added line for the same defect, so a dismissal
 * silences either producer without depending on how they phrase the change.
 */
export function hypothesisId(input: { file: string; line: number; mechanism: string }): string {
  const hash = createHash("sha1")
    .update(`${input.file}:${input.line}:${input.mechanism}`)
    .digest("hex");
  return `s_${hash.slice(0, 10)}`;
}

export interface HypothesisScanInput {
  files: CodegraphChangedFile[];
  analyses: Map<string, FileAnalysis>;
  report: CodegraphReport;
  maxHypotheses?: number;
}

export interface HypothesisScanResult {
  hypotheses: Hypothesis[];
  warnings: string[];
}

interface FileRuleContext {
  file: CodegraphChangedFile;
  patch: ParsedPatch;
  analysis?: FileAnalysis;
  graph?: CodegraphFileGraph;
}

const SKIP_FILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$|\.min\.(js|css)$|(^|\/)(dist|vendor|node_modules|__snapshots__)\//i;
const DOC_FILE = /\.(md|mdx|txt|rst)$/i;

function symbolAt(analysis: FileAnalysis | undefined, line: number): string | undefined {
  const symbols: CodeGraphSymbol[] = analysis?.symbols ?? [];
  let best: CodeGraphSymbol | undefined;
  for (const symbol of symbols) {
    if (symbol.line <= line && line <= symbol.endLine) {
      if (!best || symbol.endLine - symbol.line < best.endLine - best.line) best = symbol;
    }
  }
  return best ? best.qualifiedName || best.name : undefined;
}

function downstreamFor(graph: CodegraphFileGraph | undefined): HypothesisDownstream[] {
  if (!graph) return [];
  const out: HypothesisDownstream[] = [];
  const seen = new Set<string>();
  for (const caller of graph.callers.slice(0, 6)) {
    const key = `calls:${caller.file}#${caller.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol: caller.symbol, file: caller.file, relation: "calls" });
  }
  for (const importer of graph.importedBy.slice(0, 4)) {
    const key = `imports:${importer}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ symbol: "", file: importer, relation: "imports" });
  }
  return out;
}

function build(ctx: FileRuleContext, fields: {
  ruleId: string;
  mechanism: HypothesisMechanism;
  severity: HypothesisSeverity;
  confidence: number;
  line: number;
  snippet: string;
  change: string;
  why: string;
  question: string;
  symbol?: string;
}): Hypothesis {
  return {
    id: hypothesisId({ file: ctx.file.path, line: fields.line, mechanism: fields.mechanism }),
    ruleId: fields.ruleId,
    source: "rule",
    mechanism: fields.mechanism,
    severity: fields.severity,
    confidence: fields.confidence,
    file: ctx.file.path,
    line: fields.line,
    snippet: fields.snippet.trim().slice(0, 300),
    symbol: fields.symbol ?? symbolAt(ctx.analysis, fields.line),
    change: fields.change,
    why: fields.why,
    question: fields.question,
    downstream: downstreamFor(ctx.graph),
  };
}

// ---------------------------------------------------------------------------
// Rule 1 — configuration/threshold changes (timeouts, retries, pools, limits).
// ---------------------------------------------------------------------------

const THRESHOLD_KEY =
  /\b(timeout\w*|retry|retries|retryCount|backoff\w*|ttl|expir\w*|pool\w*|max\w*|min\w*|limit|capacity|batch\w*|delay\w*|interval\w*|concurrenc\w*|parallel\w*|size|budget)\b/i;
const ASSIGNMENT = /([A-Za-z_$][\w$]*)\s*(?::|=)\s*([^,;{}]+)/;

function keyedAssignment(line: string): { key: string; value: string } | undefined {
  const match = ASSIGNMENT.exec(line);
  if (!match) return undefined;
  const key = match[1];
  if (!THRESHOLD_KEY.test(key)) return undefined;
  return { key, value: match[2].trim().replace(/\s*(\/\/|#).*$/, "") };
}

function previousValue(patch: ParsedPatch, key: string): string | undefined {
  for (const removed of patch.removed) {
    const match = ASSIGNMENT.exec(removed.text);
    if (match && match[1] === key) return match[2].trim().replace(/\s*(\/\/|#).*$/, "");
  }
  return undefined;
}

function thresholdShape(key: string): {
  mechanism: HypothesisMechanism;
  severity: HypothesisSeverity;
  why: string;
  question: string;
} {
  if (/retry|backoff/i.test(key)) {
    return {
      mechanism: "race",
      severity: "high",
      why: `Changing ${key} alters how work is replayed; a retry can duplicate a non-idempotent side effect or interleave with a concurrent writer that now sees a half-applied change.`,
      question: `Can a replayed attempt race an in-flight write, or apply the same side effect twice?`,
    };
  }
  if (/ttl|expir|cache/i.test(key)) {
    return {
      mechanism: "stale-state",
      severity: "medium",
      why: `${key} governs how long data survives; readers can now observe a stale or partially refreshed value and disagree with the source of truth.`,
      question: `After ${key} elapses, what do readers see, and can they act on stale data?`,
    };
  }
  if (/delay|interval|debounce|throttle/i.test(key)) {
    return {
      mechanism: "race",
      severity: "medium",
      why: `${key} changes when work runs; overlapping windows can now interleave state reads and writes.`,
      question: `Can two runs now overlap because of the new ${key}?`,
    };
  }
  if (/timeout/i.test(key)) {
    return {
      mechanism: "resource-leak",
      severity: "high",
      why: `${key} keeps callers waiting longer; every in-flight request holds its connection, handle and memory for the new duration, so pools and concurrency limits fill faster and failures surface later or not at all.`,
      question: `What bounds the number of concurrent holders of this ${key}, and what happens when that bound is reached?`,
    };
  }
  if (/pool|max|min|limit|capacity|concurren|parallel|size|batch|budget/i.test(key)) {
    return {
      mechanism: "resource-leak",
      severity: "high",
      why: `Changing ${key} lets more work run at once; the resource it protects can be over-committed, so it leaks or fails under load.`,
      question: `Which resource does ${key} protect, and does the new value exceed what it can hold?`,
    };
  }
  return {
    mechanism: "wrong-value",
    severity: "medium",
    why: `Consumers may still assume the previous ${key}; downstream code that compares, multiplies or validates against it can now produce wrong values.`,
    question: `Who consumes ${key}, and does the new value stay inside the range they assume?`,
  };
}

function thresholdRule(ctx: FileRuleContext): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const [line, text] of ctx.patch.added) {
    const assignment = keyedAssignment(text);
    if (!assignment) continue;
    const previous = previousValue(ctx.patch, assignment.key);
    if (previous !== undefined && previous === assignment.value) continue;
    const change =
      previous !== undefined
        ? `${assignment.key}: ${previous} → ${assignment.value}`
        : `${assignment.key} set to ${assignment.value}`;
    const shape = thresholdShape(assignment.key);
    out.push(
      build(ctx, {
        ruleId: "threshold-change",
        ...shape,
        confidence: previous !== undefined ? 0.6 : 0.45,
        line,
        snippet: text,
        change,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 2 — export contract changes with callers outside the diff.
// ---------------------------------------------------------------------------

const EXPORT_DECL =
  /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/;
const PARAMS = /\(([^)]*)\)/;

function contractRule(ctx: FileRuleContext): Hypothesis[] {
  if (!ctx.graph || (ctx.graph.callers.length === 0 && ctx.graph.importedBy.length === 0)) return [];
  const removedExports = new Map<string, { line: number; text: string }>();
  for (const removed of ctx.patch.removed) {
    const match = EXPORT_DECL.exec(removed.text);
    if (match && !removedExports.has(match[1])) removedExports.set(match[1], removed);
  }
  const addedExports = new Map<string, { line: number; text: string }>();
  for (const [line, text] of ctx.patch.added) {
    const match = EXPORT_DECL.exec(text);
    if (match && !addedExports.has(match[1])) addedExports.set(match[1], { line, text });
  }

  const out: Hypothesis[] = [];
  for (const [name, removed] of removedExports) {
    const added = addedExports.get(name);
    if (!added) {
      const change = `removed export ${name}`;
      out.push(
        build(ctx, {
          ruleId: "contract-change",
          mechanism: "contract-break",
          severity: "high",
          confidence: 0.55,
          line: removed.line,
          snippet: removed.text,
          symbol: name,
          change,
          why: `${ctx.file.path} is used outside this diff; callers that import or reference ${name} no longer resolve it.`,
          question: `Do the remaining callers still import or reference ${name}?`,
        }),
      );
      continue;
    }
    const before = PARAMS.exec(removed.text)?.[1];
    const after = PARAMS.exec(added.text)?.[1];
    if (before !== undefined && after !== undefined && before.trim() !== after.trim()) {
      const change = `signature of ${name}: (${before.trim()}) → (${after.trim()})`;
      out.push(
        build(ctx, {
          ruleId: "contract-change",
          mechanism: "contract-break",
          severity: "high",
          confidence: 0.5,
          line: added.line,
          snippet: added.text,
          symbol: name,
          change,
          why: `Callers outside the diff call ${name} with the old arguments; the new signature changes behavior or fails to compile.`,
          question: `Do all external callers of ${name} pass arguments the new signature accepts?`,
        }),
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 3 — storage keys written in the diff and read elsewhere.
// ---------------------------------------------------------------------------

const SET_ITEM = /(?:localStorage|sessionStorage)\.setItem\(\s*["'`]([^"'`]{2,80})["'`]\s*,\s*([^)]*)\)/;
const ANY_SET_ITEM = /\.setItem\(\s*["'`]([^"'`]{2,80})["'`]\s*,\s*([^)]*)\)/;
const GET_ITEM = /(?:localStorage|sessionStorage)\.getItem\(\s*["'`]([^"'`]{2,80})["'`]/;
/** Keys that name an entity identifier, e.g. `ag.activeWorkspaceId`. */
const ID_KEY = /(?:[a-z0-9](?:Id|_id|-id))$/;
const ID_VALUE = /\bid\b|Id\b|_id\b|\.id\b|String\s*\(/i;

function stateKeyRule(ctx: FileRuleContext, strings: Map<string, Set<string>>): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const [line, text] of ctx.patch.added) {
    const set = SET_ITEM.exec(text) ?? ANY_SET_ITEM.exec(text);
    if (!set) continue;
    const key = set[1];
    const value = (set[2] ?? "").trim();
    let reader: { path: string; line: number } | undefined;
    for (const [otherLine, otherText] of ctx.patch.added) {
      const get = GET_ITEM.exec(otherText);
      if (get && get[1] === key) {
        reader = { path: ctx.file.path, line: otherLine };
        break;
      }
    }
    if (!reader) {
      for (const [path, values] of strings) {
        if (path === ctx.file.path || !values.has(key)) continue;
        reader = { path, line: 0 };
        break;
      }
    }
    if (!reader) {
      // No reader in the diff: flag a key/value concept mismatch. Writing a
      // non-identifier into an `<x>Id` key silently poisons whoever reads it.
      if (value.length > 0 && ID_KEY.test(key) && !ID_VALUE.test(value)) {
        const change = `writes ${value} to storage key "${key}"`;
        out.push(
          build(ctx, {
            ruleId: "state-key-mismatch",
            mechanism: "state-corruption",
            severity: "medium",
            confidence: 0.4,
            line,
            snippet: text,
            change,
            why: `The key names an identifier ("${key}") but the written value (\`${value}\`) is not one; code that reads this key as an id silently works with the wrong concept.`,
            question: `Do the readers of "${key}" expect an id rather than \`${value}\`?`,
          }),
        );
      }
      continue;
    }
    const where = reader.line > 0 ? `${reader.path}:${reader.line}` : reader.path;
    const change = `writes storage key "${key}"`;
    out.push(
      build(ctx, {
        ruleId: "state-key-write",
        mechanism: "state-corruption",
        severity: "medium",
        confidence: reader.line > 0 ? 0.5 : 0.4,
        line,
        snippet: text,
        change,
        why: `The same key is read at ${where}; if this write changes the shape, timing or precedence of "${key}", that reader interprets a different concept and silently uses wrong state.`,
        question: `Do the writer here and the reader at ${where} agree on the type and meaning of "${key}"?`,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 4 — async and error handling changes.
// ---------------------------------------------------------------------------

const EMPTY_CATCH = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/;
const CALL_VERB =
  /\b(?:save|send|write|update|delete|remove|process|handle|execute|publish|persist|upload|emit|notify|submit|cancel|close|commit|sync)\w*\s*\(/i;
const DECLARATION = /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|class|const|let|var)\b/;

function countMatches(text: string, regex: RegExp): number {
  const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  return (text.match(global) ?? []).length;
}

function asyncRule(ctx: FileRuleContext): Hypothesis[] {
  const out: Hypothesis[] = [];
  for (const [line, text] of ctx.patch.added) {
    if (EMPTY_CATCH.test(text)) {
      out.push(
        build(ctx, {
          ruleId: "empty-catch",
          mechanism: "swallowed-error",
          severity: "medium",
          confidence: 0.65,
          line,
          snippet: text,
          change: "added an empty catch block",
          why: `The failure is discarded; callers cannot distinguish success from failure and retries or alerts never fire.`,
          question: `What should happen when this operation fails — and who needs to know?`,
        }),
      );
    }
    if (CALL_VERB.test(text) && !/\bawait\b|\breturn\b|\.then\(|\bvoid\b|=>|[^=!<>]=[^=]/.test(text) && !DECLARATION.test(text)) {
      out.push(
        build(ctx, {
          ruleId: "unawaited-call",
          mechanism: "race",
          severity: "medium",
          confidence: 0.4,
          line,
          snippet: text,
          change: "calls a state-changing operation without await or catch",
          why: `The call floats: its rejection is unobserved and it can interleave with the statements that follow.`,
          question: `Is it safe to lose this call's result, and can the next statement observe state before it finishes?`,
        }),
      );
    }
  }

  const removedText = ctx.patch.removed.map((entry) => entry.text).join("\n");
  const addedText = [...ctx.patch.added.values()].join("\n");
  const removedCatches = countMatches(removedText, /\bcatch\b/);
  const addedCatches = countMatches(addedText, /\bcatch\b/);
  if (removedCatches > addedCatches) {
    const first = ctx.patch.removed.find((entry) => /\bcatch\b/.test(entry.text))!;
    out.push(
      build(ctx, {
        ruleId: "removed-catch",
        mechanism: "swallowed-error",
        severity: "medium",
        confidence: 0.4,
        line: first.line,
        snippet: first.text,
        change: `${removedCatches - addedCatches} error handler(s) removed`,
        why: `Failures that were handled now propagate or disappear depending on the caller.`,
        question: `Who handles this failure now that the catch block is gone?`,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 5 — fallback/guard removal.
// ---------------------------------------------------------------------------

const GUARD = /\?\?|\|\||==\s*null|===\s*null|!=\s*null|!==\s*null|if\s*\(\s*!\s*[A-Za-z_$]/;

function guardRule(ctx: FileRuleContext): Hypothesis[] {
  const removedGuards = ctx.patch.removed.filter((entry) => GUARD.test(entry.text));
  if (removedGuards.length === 0) return [];
  const addedText = [...ctx.patch.added.values()].join("\n");
  if (countMatches(addedText, GUARD) > 0) return [];
  const first = removedGuards[0];
  return [
    build(ctx, {
      ruleId: "guard-removal",
      mechanism: "crash",
      severity: "medium",
      confidence: 0.35,
      line: first.line,
      snippet: first.text,
      change: "removed a null/fallback guard",
      why: `The value the guard protected can now reach downstream code as undefined or null.`,
      question: `What receives this value after the guard, and can it be undefined or null on that path?`,
    }),
  ];
}

// ---------------------------------------------------------------------------
// Rule 6 — changed conditions and literals (inverted or swapped logic).
// Hunk-level analysis: a removed and an added line with the same skeleton but a
// different condition signature is a deliberate-looking rewrite of behavior.
// ---------------------------------------------------------------------------

const CONDITION_OPERATORS = /===|!==|==|!=|<=|>=|&&|\|\||\?\?|!/g;
const STRING_LITERAL = /(["'`])(?:\\.|(?!\1).)*\1/g;

function conditionSkeleton(line: string): string {
  return line
    .replace(/\/\/.*$/, "")
    .replace(/!\s*/g, "")
    .replace(STRING_LITERAL, "#")
    .replace(/\b\d[\d_.]*n?\b/g, "#")
    .replace(/===|!==|==|!=|<=|>=|&&|\|\||[<>?!]/g, "#")
    .replace(/\b(?:true|false|null|undefined)\b/g, "#")
    .replace(/\s+/g, "");
}

function ternaryMappings(line: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const match of line.matchAll(/(["'`][A-Za-z0-9_-]{1,40}["'`])\s*\?\s*([A-Za-z0-9_.'"`]+)/g)) {
    out.set(match[1], match[2]);
  }
  return out;
}

function operatorSequence(line: string): string[] {
  return [...line.matchAll(CONDITION_OPERATORS)].map((match) => match[0]);
}

function booleanLiterals(line: string): string {
  return (line.match(/\b(?:true|false)\b/g) ?? []).join(",");
}

export function conditionRule(ctx: FileRuleContext): Hypothesis[] {
  const out: Hypothesis[] = [];
  const usedRemoved = new Set<number>();
  for (const [line, addedText] of ctx.patch.added) {
    const skeleton = conditionSkeleton(addedText);
    if (!skeleton || skeleton.length < 6) continue;
    let paired = -1;
    for (let index = 0; index < ctx.patch.removed.length; index += 1) {
      if (usedRemoved.has(index)) continue;
      if (conditionSkeleton(ctx.patch.removed[index].text) === skeleton) {
        paired = index;
        break;
      }
    }
    if (paired === -1) continue;
    usedRemoved.add(paired);
    const removed = ctx.patch.removed[paired];

    let change: string | undefined;
    let confidence = 0.6;
    const mappingDiffs: string[] = [];
    const before = ternaryMappings(removed.text);
    const after = ternaryMappings(addedText);
    for (const [key, beforeValue] of before) {
      const afterValue = after.get(key);
      if (afterValue === undefined || afterValue === beforeValue) continue;
      mappingDiffs.push(`${key}: ${beforeValue} → ${afterValue}`);
    }
    if (mappingDiffs.length > 0) {
      change = `mapping changed (${mappingDiffs.join(", ")})`;
      confidence = 0.7;
    } else {
      const beforeOps = operatorSequence(removed.text);
      const afterOps = operatorSequence(addedText);
      if (beforeOps.length > 0 && beforeOps.join(" ") !== afterOps.join(" ")) {
        change = `condition rewritten: ${beforeOps.join(" ")} → ${afterOps.join(" ")}`;
      } else if (booleanLiterals(removed.text) !== booleanLiterals(addedText)) {
        change = `boolean changed: ${booleanLiterals(removed.text) || "(none)"} → ${booleanLiterals(addedText) || "(none)"}`;
        confidence = 0.5;
      }
    }
    if (!change) continue;

    out.push(
      build(ctx, {
        ruleId: "condition-change",
        mechanism: "wrong-value",
        severity: "high",
        confidence,
        line,
        snippet: addedText,
        change,
        why: `The condition now resolves differently; callers and labels that assumed the previous branch take the other path and quietly act on the wrong values.`,
        question: `Which input now takes this branch, and does the result still match what the label or caller expects?`,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule 7 — cleanup/release calls removed.
// ---------------------------------------------------------------------------

const CLEANUP = /\b(clear|cleanup|disconnect|close|abort|unsubscribe|cancel|release|revoke|destroy|flush|teardown)\w*\s*\(/i;
const HIGH_IMPACT_CLEANUP = /disconnect|close|abort|release|revoke|destroy|unsubscribe/i;

function cleanupRule(ctx: FileRuleContext): Hypothesis[] {
  const addedText = [...ctx.patch.added.values()].join("\n");
  const out: Hypothesis[] = [];
  const seen = new Set<string>();
  for (const removed of ctx.patch.removed) {
    const match = CLEANUP.exec(removed.text);
    if (!match) continue;
    const verb = match[1];
    if (seen.has(verb.toLowerCase())) continue;
    if (new RegExp(`\\b${verb}\\w*\\s*\\(`, "i").test(addedText)) continue;
    seen.add(verb.toLowerCase());
    const change = `removed ${verb} call`;
    out.push(
      build(ctx, {
        ruleId: "cleanup-removal",
        mechanism: "resource-leak",
        severity: HIGH_IMPACT_CLEANUP.test(verb) ? "high" : "medium",
        confidence: 0.45,
        line: removed.line,
        snippet: removed.text,
        change,
        why: `The ${verb} path is gone, so the resource or state it released persists and accumulates.`,
        question: `Who releases this resource now, and what accumulates if nobody does?`,
      }),
    );
  }
  return out;
}

// ---------------------------------------------------------------------------

export function scanHypotheses(input: HypothesisScanInput): HypothesisScanResult {
  const graphByPath = new Map(input.report.files.map((file) => [file.path, file]));
  const strings = new Map<string, Set<string>>();
  for (const [path, analysis] of input.analyses) {
    strings.set(path, new Set((analysis.strings ?? []).map((entry) => entry.value)));
  }

  const collected: Hypothesis[] = [];
  for (const file of input.files) {
    if (file.status === "removed") continue;
    if (!file.patch || SKIP_FILE.test(file.path) || DOC_FILE.test(file.path)) continue;
    const patch = parsePatch(file.path, file.patch);
    if (patch.added.size === 0 && patch.removed.length === 0) continue;
    const ctx: FileRuleContext = {
      file,
      patch,
      analysis: input.analyses.get(file.path),
      graph: graphByPath.get(file.path),
    };
    collected.push(
      ...thresholdRule(ctx),
      ...contractRule(ctx),
      ...stateKeyRule(ctx, strings),
      ...asyncRule(ctx),
      ...conditionRule(ctx),
      ...guardRule(ctx),
      ...cleanupRule(ctx),
    );
  }

  const deduped = new Map<string, Hypothesis>();
  for (const hypothesis of collected) {
    const key = `${hypothesis.file}:${hypothesis.line}:${hypothesis.mechanism}`;
    const existing = deduped.get(key);
    if (!existing || hypothesis.confidence > existing.confidence) deduped.set(key, hypothesis);
  }
  const sorted = sortHypotheses([...deduped.values()]);
  const max = input.maxHypotheses ?? 12;
  return {
    hypotheses: sorted.slice(0, max),
    warnings: sorted.length > max ? [`capped ${sorted.length - max} lower-ranked rule hypothesis(s)`] : [],
  };
}
