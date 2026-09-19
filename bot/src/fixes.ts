/**
 * Stage 3 — fixes. The coordinator (GLM 5.3) turns each hypothesis into a fix
 * plan; the codegen model (GPT 5.6 Sol) writes the actual patch as exact find/replace
 * edits against the current head. Drafts only: nothing is compiled, applied or
 * pushed, and every fix carries its plan, confidence and validation status.
 */
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import * as githubApi from "../../server/lib/github/api.ts";
import { runAgent } from "./agent.ts";
import { parseJson } from "./master.ts";
import { parsePatches, renderChangedPatches, type ParsedPatch } from "./patch.ts";
import { buildCodegraphReport } from "./codegraph.ts";
import { codegenSystem, codegenUser, coordinatorFixPlanSystem, coordinatorFixPlanUser } from "./prompts.ts";
import { createPullRequestReview, deletePullRequestReviewComment, listPullRequestReviewComments } from "../../server/lib/github/api.ts";
import {
  BudgetedModelClient,
  CodeBotUsageCollectingClient,
  codeBotCacheKey,
  codegenModelConfig,
  createCodeBotModelClient,
  createCodeBotUsageTracker,
  isCodeBotBudgetError,
  resolveCodeBotModelConfig,
  resolveCodeBotSwarmConfig,
  type CodeBotMessage,
  type CodeBotModelClient,
  type CodeBotModelConfig,
  type CodeBotSwarmConfig,
  type CodeBotUsageTracker,
} from "./model.ts";
import { buildHypothesisReport } from "./hypotheses.ts";
import { publishCodeBotComment } from "./github.ts";
import { buildFixesComment, FIXES_MARKER } from "./markdown.ts";
import { analyseChangedFiles, loadChangedFiles, loadPullRequestContext, loadRepoGraphIndex } from "./run-inputs.ts";
import { executeReadTool, READ_TOOL_NAMES, type ReadToolContext } from "./tools.ts";
import { sortHypotheses } from "./rules.ts";
import type { Repository } from "@shared/schema";
import type {
  CodegraphChangedFile,
  CodegraphReport,
  FixEdit,
  FixOutcome,
  FixPlan,
  FixReport,
  FixStageResult,
  GeneratedFix,
  Hypothesis,
  HypothesisReport,
  HypothesisSeverity,
  RepoGraphIndex,
} from "./types.ts";
import { CODEBOT_VERSION } from "./version.ts";

const MAX_EDITS_PER_FIX = 6;
const MAX_CODEGEN_ATTEMPTS = 2;
const MAX_PLAN_DIFF_CHARS = 20_000;
const MAX_CODEGEN_DIFF_CHARS = 12_000;

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface FixPlanParseInput {
  hypotheses: Hypothesis[];
  maxFixes: number;
}

export function parseFixPlans(
  text: string,
  input: FixPlanParseInput,
): { plans: FixPlan[]; notFixable: Map<string, string>; dropped: number } {
  const parsed = parseJson(text);
  const known = new Set(input.hypotheses.map((hypothesis) => hypothesis.id));
  const plans: FixPlan[] = [];
  const notFixable = new Map<string, string>();
  let dropped = 0;
  const seen = new Set<string>();

  const rawPlans = Array.isArray(parsed?.fixes) ? parsed!.fixes : [];
  for (const entry of rawPlans) {
    if (!entry || typeof entry !== "object") {
      dropped += 1;
      continue;
    }
    const record = entry as Record<string, unknown>;
    const hypothesisId = typeof record.hypothesisId === "string" ? record.hypothesisId.trim() : "";
    const summary = typeof record.summary === "string" ? record.summary.trim() : "";
    const steps = Array.isArray(record.steps)
      ? record.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0).map((step) => step.trim())
      : [];
    const files = Array.isArray(record.files)
      ? [...new Set(record.files.filter((file): file is string => typeof file === "string" && file.trim().length > 0).map((file) => file.trim()))]
      : [];
    if (!hypothesisId || !known.has(hypothesisId) || !summary || steps.length === 0 || seen.has(hypothesisId)) {
      dropped += 1;
      continue;
    }
    seen.add(hypothesisId);
    plans.push({
      hypothesisId,
      summary,
      steps,
      files,
      risks: typeof record.risks === "string" && record.risks.trim() ? record.risks.trim() : undefined,
      testIdea: typeof record.testIdea === "string" && record.testIdea.trim() ? record.testIdea.trim() : undefined,
    });
    if (input.maxFixes > 0 && plans.length >= input.maxFixes) break;
  }

  const rawNotFixable = Array.isArray(parsed?.notFixable) ? parsed!.notFixable : [];
  for (const entry of rawNotFixable) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const hypothesisId = typeof record.hypothesisId === "string" ? record.hypothesisId.trim() : "";
    const reason = typeof record.reason === "string" ? record.reason.trim() : "";
    if (!hypothesisId || !known.has(hypothesisId)) continue;
    notFixable.set(hypothesisId, reason || "the coordinator judged it not fixable without more information");
  }

  return { plans, notFixable, dropped };
}

export interface FixPlannerInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  hypotheses: Hypothesis[];
  files: CodegraphChangedFile[];
  maxFixes: number;
  client: CodeBotModelClient;
  signal?: AbortSignal;
  cacheKey?: string;
}

export interface FixPlannerResult {
  plans: FixPlan[];
  notFixable: Map<string, string>;
  dropped: number;
  warnings: string[];
}

export async function runFixPlanner(input: FixPlannerInput): Promise<FixPlannerResult> {
  const completion = await input.client.complete({
    system: coordinatorFixPlanSystem(input.maxFixes),
    user: coordinatorFixPlanUser({
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      title: input.title,
      headSha: input.headSha,
      diff: renderChangedPatches(input.files, MAX_PLAN_DIFF_CHARS),
      hypotheses: input.hypotheses,
      maxFixes: input.maxFixes,
    }),
    signal: input.signal,
    cacheKey: input.cacheKey,
  });
  const result = parseFixPlans(completion.text, { hypotheses: input.hypotheses, maxFixes: input.maxFixes });
  return {
    ...result,
    warnings: result.dropped > 0 ? [`dropped ${result.dropped} invalid fix plan(s) from the coordinator`] : [],
  };
}

// ---------------------------------------------------------------------------
// Edit validation and rendering
// ---------------------------------------------------------------------------

export interface RawFixEdit {
  path: string;
  find: string;
  replace: string;
}

export interface EditValidation {
  edits: FixEdit[];
  errors: string[];
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function parseRawEdits(final: Record<string, unknown> | undefined): RawFixEdit[] {
  if (!final || !Array.isArray(final.edits)) return [];
  return final.edits
    .slice(0, MAX_EDITS_PER_FIX)
    .map((entry) => (entry && typeof entry === "object" ? (entry as Record<string, unknown>) : undefined))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .map((entry) => ({
      path: typeof entry.path === "string" ? entry.path.trim() : "",
      find: typeof entry.find === "string" ? entry.find : "",
      replace: typeof entry.replace === "string" ? entry.replace : "",
    }))
    .filter((edit) => edit.path.length > 0 && edit.find.length > 0);
}

export function lineRangeAt(content: string, find: string): { startLine: number; endLine: number } | undefined {
  const index = content.indexOf(find);
  if (index === -1) return undefined;
  const startLine = content.slice(0, index).split("\n").length;
  const endLine = startLine + find.split("\n").length - 1;
  return { startLine, endLine };
}

/** New-side lines present in the patch: added lines and context lines. */
export function newSideLinesOf(patches: Map<string, ParsedPatch>): Map<string, Set<number>> {
  const map = new Map<string, Set<number>>();
  for (const [path, patch] of patches) {
    const lines = new Set<number>();
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.newLine !== null) lines.add(line.newLine);
      }
    }
    map.set(path, lines);
  }
  return map;
}

export async function validateFixEdits(
  rawEdits: RawFixEdit[],
  input: {
    changedFiles: Set<string>;
    readFile: (path: string) => Promise<string | undefined>;
    /** New-side line numbers per file, for native suggestion eligibility. */
    newSideLines?: Map<string, Set<number>>;
  },
): Promise<EditValidation> {
  const edits: FixEdit[] = [];
  const errors: string[] = [];
  if (rawEdits.length === 0) errors.push("the model returned no edits");
  for (const raw of rawEdits) {
    if (raw.replace === raw.find) {
      errors.push(`${raw.path}: the replacement is identical to the original text`);
      continue;
    }
    const content = await input.readFile(raw.path).catch(() => undefined);
    if (content === undefined) {
      errors.push(`${raw.path}: the file could not be read at the PR head`);
      continue;
    }
    const occurrences = countOccurrences(content, raw.find);
    if (occurrences === 0) {
      errors.push(`${raw.path}: the find text does not appear in the current file`);
      continue;
    }
    if (occurrences > 1) {
      errors.push(`${raw.path}: the find text appears ${occurrences} times; make it unique`);
      continue;
    }
    const range = lineRangeAt(content, raw.find);
    const diffLines = input.newSideLines?.get(raw.path);
    const inDiff =
      range !== undefined && diffLines !== undefined
        ? Array.from({ length: range.endLine - range.startLine + 1 }, (_, offset) => range.startLine + offset).every((line) =>
            diffLines.has(line),
          )
        : false;
    edits.push({
      path: raw.path,
      find: raw.find,
      replace: raw.replace,
      outsideDiff: !input.changedFiles.has(raw.path),
      startLine: range?.startLine,
      endLine: range?.endLine,
      inDiff,
    });
  }
  return { edits, errors };
}

// ---------------------------------------------------------------------------
// Codegen agent
// ---------------------------------------------------------------------------

export interface CodegenAgentInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  installationId?: string | number;
  fullName?: string;
  hypothesis: Hypothesis;
  plan: FixPlan;
  files: CodegraphChangedFile[];
  patches: Map<string, ParsedPatch>;
  analyses: Map<string, FileAnalysis>;
  report: CodegraphReport;
  index: RepoGraphIndex | null;
  client: CodeBotModelClient;
  config: CodeBotSwarmConfig;
  deadline: number;
  /** Shared, identical prefix for every codegen call so the provider can cache it. */
  sharedContext?: string;
  /** Sandbox verification failure fed back into a repair attempt. */
  failureContext?: string;
  signal?: AbortSignal;
  onLog?: (message: string) => void;
  readFile?: (path: string) => Promise<string | undefined>;
  searchCode?: (query: string) => Promise<Array<{ path: string; fragments: string[] }>>;
  cacheKey?: string;
}

export interface CodegenAgentResult {
  edits: FixEdit[];
  summary: string;
  confidence: number;
  refused?: string;
  attempts: number;
  errors: string[];
  transportFailure?: string;
  /** True when the cost budget blocked the call before any edit was written. */
  budgetBlocked?: boolean;
  toolCalls: number;
  turns: number;
  stoppedReason: string;
  usage: {
    calls: number;
    tokensIn: number;
    tokensOut: number;
    cachedTokensIn: number;
    costUsd: number;
  };
}

export async function runCodegenAgent(input: CodegenAgentInput): Promise<CodegenAgentResult> {
  const contentCache = new Map<string, string | undefined>();
  const githubRead = async (path: string): Promise<string | undefined> => {
    if (contentCache.has(path)) return contentCache.get(path);
    const content = await githubApi
      .getFileContent(input.installationId ?? 0, input.fullName ?? input.repository, path, input.headSha)
      .catch(() => null);
    const value = content ?? undefined;
    contentCache.set(path, value);
    return value;
  };
  const readFile = input.readFile ?? githubRead;
  const changedFiles = new Set(input.files.map((file) => file.path));
  const newSideLines = newSideLinesOf(input.patches);
  const toolContext: ReadToolContext = {
    fullName: input.fullName ?? input.repository,
    headSha: input.headSha,
    patches: input.patches,
    analyses: input.analyses,
    report: input.report,
    repoFiles: (input.index?.files ?? []).map((file) => file.path),
    readFile,
    searchCode: input.config.searchEnabled
      ? input.searchCode ?? ((query: string) => githubApi.searchCode(input.installationId ?? 0, input.fullName ?? input.repository, query, 8))
      : undefined,
    signal: input.signal,
  };

  const planFiles = input.plan.files.length > 0 ? input.plan.files : [input.hypothesis.file];
  const scoped = input.files.filter((file) => planFiles.includes(file.path));
  const groundingFile = scoped.find((file) => file.patch)?.path ?? planFiles[0];
  const fileDiffs = renderChangedPatches(scoped.length > 0 ? scoped : input.files.slice(0, 1), MAX_CODEGEN_DIFF_CHARS);
  const outsideDiffNote =
    planFiles.some((file) => !changedFiles.has(file))
      ? `The plan touches files outside the PR diff: ${planFiles.filter((file) => !changedFiles.has(file)).join(", ")}. Read them before editing; those edits will be flagged.`
      : undefined;

  const baseUser = codegenUser({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    title: input.title,
    headSha: input.headSha,
    hypothesis: input.hypothesis,
    plan: input.plan,
    fileDiffs,
    outsideDiffNote,
    failureContext: input.failureContext,
  });

  let priorHistory: CodeBotMessage[] = [];
  let feedback: string | undefined;
  let lastErrors: string[] = [];
  let lastTransport: string | undefined;
  let toolCalls = 0;
  let turns = 0;
  let stoppedReason = "no attempt";
  const collecting = new CodeBotUsageCollectingClient(input.client);

  for (let attempt = 1; attempt <= MAX_CODEGEN_ATTEMPTS; attempt += 1) {
    const feedbackBlock =
      attempt > 1 && feedback ? `## Previous attempt failed\n${feedback}\nFix the edits and return the final JSON again.` : "";
    const user = priorHistory.length > 0 ? feedbackBlock : [baseUser, feedbackBlock].filter(Boolean).join("\n\n");
    let result;
    try {
      result = await runAgent({
        system: codegenSystem(input.sharedContext),
        user,
        initialHistory: priorHistory,
        tools: READ_TOOL_NAMES,
        execute: (action) => executeReadTool(action, toolContext),
        client: collecting,
        maxTurns: input.config.codegenTurns,
        maxToolsPerTurn: input.config.maxToolsPerTurn,
        deadline: input.deadline,
        minToolCallsBeforeFinal: 1,
        groundingAction: groundingFile ? { tool: "read_diff", args: { path: groundingFile } } : undefined,
        label: `fix-${input.hypothesis.id}`,
        onLog: input.onLog,
        signal: input.signal,
        cacheKey: input.cacheKey,
        stopWhenNoNewEvidence: true,
        isFinal: (parsed) => Array.isArray(parsed.edits) || parsed.refused === true,
        hasContent: (parsed) => (Array.isArray(parsed.edits) && parsed.edits.length > 0) || parsed.refused === true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isCodeBotBudgetError(error)) {
        return {
          edits: [],
          summary: "",
          confidence: 0,
          attempts: attempt,
          errors: [message],
          budgetBlocked: true,
          toolCalls,
          turns,
          stoppedReason: "budget",
          usage: collecting.usage,
        };
      }
      lastTransport = message;
      lastErrors = [message];
      feedback = `- transport error: ${message}`;
      if (input.signal?.aborted) break;
      continue;
    }
    toolCalls += result.toolCalls;
    turns += result.turns;
    stoppedReason = result.stoppedReason;

    if (result.final?.refused === true) {
      const reason = typeof result.final.reason === "string" && result.final.reason.trim() ? result.final.reason.trim() : "the codegen model refused to write a fix";
      return { edits: [], summary: "", confidence: 0, refused: reason, attempts: attempt, errors: [], toolCalls, turns, stoppedReason, usage: collecting.usage };
    }

    const rawEdits = parseRawEdits(result.final);
    const validation = await validateFixEdits(rawEdits, { changedFiles, readFile, newSideLines });
    if (validation.edits.length > 0 && validation.errors.length === 0) {
      const summary = typeof result.final?.summary === "string" && result.final.summary.trim() ? result.final.summary.trim() : input.plan.summary;
      const confidence =
        typeof result.final?.confidence === "number" && result.final.confidence >= 0 && result.final.confidence <= 1
          ? result.final.confidence
          : 0.5;
      return { edits: validation.edits, summary, confidence, attempts: attempt, errors: [], toolCalls, turns, stoppedReason, usage: collecting.usage };
    }
    lastTransport = undefined;
    lastErrors = validation.errors.length > 0 ? validation.errors : ["the model returned no usable edits"];
    feedback = lastErrors.map((error) => `- ${error}`).join("\n");
    priorHistory = result.history;
  }

  return {
    edits: [],
    summary: "",
    confidence: 0,
    attempts: MAX_CODEGEN_ATTEMPTS,
    errors: lastErrors,
    transportFailure: lastTransport,
    toolCalls,
    turns,
    stoppedReason,
    usage: collecting.usage,
  };
}

// ---------------------------------------------------------------------------
// Native GitHub suggestions
// ---------------------------------------------------------------------------

export interface PlannedSuggestion {
  hypothesisId: string;
  path: string;
  startLine: number;
  endLine: number;
  body: string;
}

export function buildSuggestionBody(edit: FixEdit, hypothesisId: string, header?: string): string {
  return `${SUGGESTION_MARKER} ${hypothesisId} -->${header ? `\n${header}` : ""}\n\`\`\`suggestion\n${edit.replace}\n\`\`\``;
}

export interface CollectSuggestionsOptions {
  /** One-line context shown above the suggestion block. */
  label?: string;
}

/** In-diff edits become native suggestions; the rest stay in the summary. */
export function collectSuggestions(
  fixes: GeneratedFix[],
  options: CollectSuggestionsOptions = {},
): { suggestions: PlannedSuggestion[]; skipped: number } {
  const suggestions: PlannedSuggestion[] = [];
  let skipped = 0;
  for (const fix of fixes) {
    if (fix.outcome !== "generated") continue;
    const header = options.label
      ? `**${options.label}** · ${fix.hypothesis.severity} · ${fix.attempts} attempt(s)`
      : undefined;
    for (const edit of fix.edits) {
      if (!edit.inDiff || edit.startLine === undefined || edit.endLine === undefined) {
        skipped += 1;
        continue;
      }
      suggestions.push({
        hypothesisId: fix.hypothesisId,
        path: edit.path,
        startLine: edit.startLine,
        endLine: edit.endLine,
        body: buildSuggestionBody(edit, fix.hypothesisId, header),
      });
    }
  }
  return { suggestions, skipped };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface BuildFixReportInput {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  title?: string;
  hypotheses: Hypothesis[];
  files: CodegraphChangedFile[];
  patches: Map<string, ParsedPatch>;
  analyses: Map<string, FileAnalysis>;
  report: CodegraphReport;
  index: RepoGraphIndex | null;
  installationId?: string | number;
  fullName?: string;
  maxFixes?: number;
  /** Severity gate for codegen; defaults to the swarm config's priority set. */
  severities?: HypothesisSeverity[];
  /** `null` disables model tiers; omit to build from the environment. */
  coordinatorClient?: CodeBotModelClient | null;
  codegenClient?: CodeBotModelClient | null;
  modelConfig?: CodeBotModelConfig;
  swarmConfig?: CodeBotSwarmConfig;
  readFile?: (path: string) => Promise<string | undefined>;
  searchCode?: (query: string) => Promise<Array<{ path: string; fragments: string[] }>>;
  /** Run-level budget shared with stage 2; created when absent. */
  usageTracker?: CodeBotUsageTracker;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

function emptyRole(id: string) {
  return { id, calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, failedCalls: 0 };
}

const SUGGESTION_MARKER = "<!-- codebot:fix";

function skippedFix(hypothesis: Hypothesis, outcome: FixOutcome, reason: string, plan?: FixPlan): GeneratedFix {
  return {
    hypothesisId: hypothesis.id,
    priority: hypothesis.priority ?? 0,
    hypothesis,
    plan,
    edits: [],
    summary: "",
    confidence: 0,
    attempts: 0,
    outcome,
    reason,
  };
}

export async function buildFixReport(input: BuildFixReportInput): Promise<FixReport> {
  const configured = input.modelConfig ?? resolveCodeBotModelConfig();
  const swarmConfig = input.swarmConfig ?? resolveCodeBotSwarmConfig();
  const maxFixes = input.maxFixes ?? swarmConfig.maxFixes;
  const severities = input.severities ?? swarmConfig.fixSeverities;
  const available = sortHypotheses(input.hypotheses);
  const priority = severities.length > 0 ? available.filter((hypothesis) => severities.includes(hypothesis.severity)) : available;
  const ordered = priority.slice(0, maxFixes > 0 ? maxFixes : undefined);
  const filtered = available.length - priority.length;
  const warnings: string[] = [];
  if (filtered > 0) {
    warnings.push(
      `${filtered} non-priority hypothesis(es) below ${severities.join("/")} were not fixed (priority fixes only)`,
    );
  }

  if (input.coordinatorClient === null || input.codegenClient === null) {
    return {
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      headSha: input.headSha,
      fixes: ordered.map((hypothesis) => skippedFix(hypothesis, "skipped", "model tiers disabled for this run")),
      totals: {
        available: available.length,
        hypotheses: ordered.length,
        filtered,
        generated: 0,
        notFixable: 0,
        refused: 0,
        failed: 0,
        failedTransport: 0,
        skipped: ordered.length,
        planOnly: 0,
      },
      usage: {
        coordinator: emptyRole(configured.model),
        swarm: emptyRole(configured.swarmModel),
        codegen: emptyRole(configured.codegenModel),
        totalCostUsd: 0,
        maxCostUsd: swarmConfig.maxCostUsd,
        used: false,
        reason: "model disabled for this run",
      },
      suggestions: { posted: 0, skipped: 0 },
      warnings,
    };
  }
  if (!input.coordinatorClient && !configured.apiKey) {
    return {
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      headSha: input.headSha,
      fixes: ordered.map((hypothesis) => skippedFix(hypothesis, "skipped", "no gateway key configured")),
      totals: {
        available: available.length,
        hypotheses: ordered.length,
        filtered,
        generated: 0,
        notFixable: 0,
        refused: 0,
        failed: 0,
        failedTransport: 0,
        skipped: ordered.length,
        planOnly: 0,
      },
      usage: {
        coordinator: emptyRole(configured.model),
        swarm: emptyRole(configured.swarmModel),
        codegen: emptyRole(configured.codegenModel),
        totalCostUsd: 0,
        maxCostUsd: swarmConfig.maxCostUsd,
        used: false,
        reason: "no gateway key configured; nothing to generate",
      },
      suggestions: { posted: 0, skipped: 0 },
      warnings,
    };
  }

  if (ordered.length === 0) {
    return {
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      headSha: input.headSha,
      fixes: [],
      totals: {
        available: 0,
        hypotheses: 0,
        filtered: 0,
        generated: 0,
        notFixable: 0,
        refused: 0,
        failed: 0,
        failedTransport: 0,
        skipped: 0,
        planOnly: 0,
      },
      usage: {
        coordinator: { ...emptyRole(configured.model), calls: 0 },
        swarm: emptyRole(configured.swarmModel),
        codegen: emptyRole(configured.codegenModel),
        totalCostUsd: 0,
        maxCostUsd: swarmConfig.maxCostUsd,
        used: false,
        reason: "no hypotheses to fix",
      },
      suggestions: { posted: 0, skipped: 0 },
      warnings,
    };
  }

  const tracker = input.usageTracker ?? createCodeBotUsageTracker(swarmConfig);
  tracker.beginStage("fixes");
  const coordinator = new BudgetedModelClient(
    input.coordinatorClient ?? createCodeBotModelClient(configured),
    tracker,
    "coordinator",
    { modelId: configured.model, maxOutputTokens: configured.maxTokens },
  );
  const codegen = new BudgetedModelClient(
    input.codegenClient ?? createCodeBotModelClient(codegenModelConfig(configured)),
    tracker,
    "codegen",
    { modelId: configured.codegenModel, maxOutputTokens: configured.codegenMaxTokens ?? configured.maxTokens },
  );

  let plans: FixPlan[] = [];
  let notFixable = new Map<string, string>();
  let plannerFailed: string | undefined;
  try {
    const planner = await runFixPlanner({
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      title: input.title ?? "",
      headSha: input.headSha,
      hypotheses: ordered,
      files: input.files,
      maxFixes,
      client: coordinator,
      signal: input.signal,
      cacheKey: codeBotCacheKey("coordinator", input),
    });
    plans = planner.plans;
    notFixable = planner.notFixable;
    warnings.push(...planner.warnings);
  } catch (error) {
    plannerFailed = error instanceof Error ? error.message : String(error);
    warnings.push(`fix planning failed (${plannerFailed}); no fixes were generated`);
  }

  // Orientation only: the full diff no longer rides along on every codegen
  // call. The scoped hunks in the user turn and on-demand read tools carry the
  // exact current text.
  const sharedContext = [
    `Repository: ${input.repository} · PR #${input.pullRequestNumber} · head ${input.headSha.slice(0, 8)}`,
    "Changed files:",
    ...input.files.slice(0, 40).map((file) => `- ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`),
  ].join("\n");

  // One content cache for the whole stage: the same head file is read by many
  // codegen agents and should be fetched once.
  const sharedContentCache = new Map<string, string | undefined>();
  const stageReadFile =
    input.readFile ??
    (async (path: string): Promise<string | undefined> => {
      if (sharedContentCache.has(path)) return sharedContentCache.get(path);
      const content = await githubApi
        .getFileContent(input.installationId ?? 0, input.fullName ?? input.repository, path, input.headSha)
        .catch(() => null);
      const value = content ?? undefined;
      sharedContentCache.set(path, value);
      return value;
    });

  const planById = new Map(plans.map((plan) => [plan.hypothesisId, plan]));
  const fixes: GeneratedFix[] = [];
  const pending: Array<{ hypothesis: Hypothesis; plan: FixPlan }> = [];
  for (const hypothesis of ordered) {
    const plan = planById.get(hypothesis.id);
    if (plan) pending.push({ hypothesis, plan });
    else if (notFixable.has(hypothesis.id)) fixes.push(skippedFix(hypothesis, "not_fixable", notFixable.get(hypothesis.id)!));
    else fixes.push(skippedFix(hypothesis, "skipped", plannerFailed ? `fix planning failed: ${plannerFailed}` : "the coordinator did not plan a fix"));
  }

  const deadline = Date.now() + swarmConfig.timeoutMs;
  const queue = [...pending];
  const workers = Array.from({ length: Math.max(1, Math.min(swarmConfig.codegenConcurrency, queue.length)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) return;
      if (tracker.exhausted) {
        fixes.push(
          skippedFix(
            item.hypothesis,
            "plan_only",
            `budget: plan published without a draft patch ($${tracker.remainingUsd.toFixed(4)} left of $${swarmConfig.maxCostUsd.toFixed(2)})`,
            item.plan,
          ),
        );
        continue;
      }
      if (Date.now() > deadline) {
        fixes.push(skippedFix(item.hypothesis, "skipped", "stage deadline reached", item.plan));
        continue;
      }
      try {
        const result = await runCodegenAgent({
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          title: input.title ?? "",
          headSha: input.headSha,
          installationId: input.installationId,
          fullName: input.fullName,
          hypothesis: item.hypothesis,
          plan: item.plan,
          files: input.files,
          patches: input.patches,
          analyses: input.analyses,
          report: input.report,
          index: input.index,
          client: codegen,
          config: swarmConfig,
          deadline,
          sharedContext,
          signal: input.signal,
          onLog: input.onLog,
          readFile: stageReadFile,
          searchCode: input.searchCode,
          cacheKey: codeBotCacheKey("codegen", input),
        });
        if (result.budgetBlocked) {
          fixes.push(
            skippedFix(
              item.hypothesis,
              "plan_only",
              `budget: ${result.errors[0] ?? "plan published without a draft patch"}`,
              item.plan,
            ),
          );
          warnings.push(`fix for ${item.hypothesis.id} stayed plan-only: the cost budget did not cover codegen`);
        } else if (result.refused) {
          fixes.push({ ...skippedFix(item.hypothesis, "refused", result.refused, item.plan), attempts: result.attempts });
        } else if (result.edits.length > 0 && result.errors.length === 0) {
          fixes.push({
            hypothesisId: item.hypothesis.id,
            priority: item.hypothesis.priority ?? 0,
            hypothesis: item.hypothesis,
            plan: item.plan,
            edits: result.edits,
            summary: result.summary,
            confidence: result.confidence,
            attempts: result.attempts,
            outcome: "generated",
          });
        } else if (result.transportFailure) {
          fixes.push({
            ...skippedFix(item.hypothesis, "failed_transport", result.transportFailure, item.plan),
            attempts: result.attempts,
          });
          warnings.push(`fix for ${item.hypothesis.id} failed on the model transport: ${result.transportFailure}`);
        } else {
          fixes.push({
            ...skippedFix(item.hypothesis, "failed", result.errors.join("; ") || "the codegen model returned no usable edits", item.plan),
            attempts: result.attempts,
          });
          warnings.push(`fix for ${item.hypothesis.id} failed validation after ${result.attempts} attempt(s)`);
        }
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        fixes.push({ ...skippedFix(item.hypothesis, "failed", reason, item.plan), attempts: 1 });
        warnings.push(`fix for ${item.hypothesis.id} failed: ${reason}`);
      }
    }
  });
  await Promise.all(workers);

  fixes.sort((a, b) => (a.priority || Number.MAX_SAFE_INTEGER) - (b.priority || Number.MAX_SAFE_INTEGER) || a.hypothesisId.localeCompare(b.hypothesisId));
  const count = (outcome: FixOutcome) => fixes.filter((fix) => fix.outcome === outcome).length;

  return {
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    fixes,
    totals: {
      available: available.length,
      hypotheses: ordered.length,
      filtered,
      generated: count("generated"),
      notFixable: count("not_fixable"),
      refused: count("refused"),
      failed: count("failed"),
      failedTransport: count("failed_transport"),
      skipped: count("skipped"),
      planOnly: count("plan_only"),
    },
    suggestions: { posted: 0, skipped: 0 },
    usage: {
      coordinator: { ...tracker.usage.coordinator },
      swarm: { ...tracker.usage.swarm },
      codegen: { ...tracker.usage.codegen },
      totalCostUsd: tracker.totalCostUsd,
      maxCostUsd: tracker.maxCostUsd,
      used: tracker.totalCalls > 0,
      reason: tracker.totalCalls > 0 ? undefined : plannerFailed ? `planner failed: ${plannerFailed}` : "no model call completed",
    },
    warnings,
  };
}

export interface ReplaceSuggestionsInput {
  installationId: string | number;
  fullName: string;
  pullRequestNumber: number;
  headSha: string;
  fixes: GeneratedFix[];
  body: string;
  /** Context line shown above each suggestion block. */
  label?: string;
}

export const DRAFT_SUGGESTION_BODY =
  "**CodeBot draft fixes** — one-click suggestions generated from the hypotheses stage. " +
  "They are unverified drafts: review before applying.";

export async function replaceCodeBotSuggestions(
  input: ReplaceSuggestionsInput,
): Promise<{ posted: number; skipped: number; removed: number }> {
  const existing = await listPullRequestReviewComments(input.installationId, input.fullName, input.pullRequestNumber);
  let removed = 0;
  for (const comment of existing) {
    if (comment.body.includes(SUGGESTION_MARKER)) {
      await deletePullRequestReviewComment(input.installationId, input.fullName, comment.id).catch(() => undefined);
      removed += 1;
    }
  }

  const { suggestions, skipped } = collectSuggestions(input.fixes, { label: input.label });
  if (suggestions.length === 0) return { posted: 0, skipped, removed };
  await createPullRequestReview(input.installationId, input.fullName, input.pullRequestNumber, {
    body: input.body,
    event: "COMMENT",
    commitId: input.headSha,
    comments: suggestions.map((suggestion) => ({
      path: suggestion.path,
      line: suggestion.endLine,
      ...(suggestion.endLine > suggestion.startLine ? { start_line: suggestion.startLine } : {}),
      body: suggestion.body,
    })),
  });
  return { posted: suggestions.length, skipped, removed };
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface FixStageInput {
  runId: string;
  repository: Repository;
  pullRequestNumber: number;
  dryRun?: boolean;
  /** false defers publishing to the pipeline's single review comment. */
  publish?: boolean;
  /** true keeps the drafts out of GitHub; stage 4 posts the verified set. */
  deferSuggestions?: boolean;
  maxFiles?: number;
  maxHypotheses?: number;
  maxFixes?: number;
  /** Severity gate for codegen; defaults to the swarm config's priority set. */
  severities?: HypothesisSeverity[];
  /** Structured handoff from stage 2; built internally when absent. */
  hypothesisReport?: HypothesisReport;
  modelClient?: CodeBotModelClient | null;
  swarmClient?: CodeBotModelClient | null;
  codegenClient?: CodeBotModelClient | null;
  modelConfig?: CodeBotModelConfig;
  swarmConfig?: CodeBotSwarmConfig;
  readFile?: (path: string) => Promise<string | undefined>;
  searchCode?: (query: string) => Promise<Array<{ path: string; fragments: string[] }>>;
  /** Run-level budget shared with stage 2; created when absent. */
  usageTracker?: CodeBotUsageTracker;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

export async function runFixesStage(input: FixStageInput): Promise<FixStageResult> {
  const started = Date.now();
  const repository = input.repository;
  const context = await loadPullRequestContext(repository, input.pullRequestNumber);
  const files = await loadChangedFiles({
    installationId: context.installationId,
    fullName: context.fullName,
    pullRequestNumber: input.pullRequestNumber,
    maxFiles: input.maxFiles,
  });
  const analyses = await analyseChangedFiles({
    installationId: context.installationId,
    fullName: context.fullName,
    headSha: context.headSha,
    files,
  });
  const index = await loadRepoGraphIndex(repository.id).catch(() => null);
  const report = buildCodegraphReport({
    repository: repository.fullName,
    pullRequestNumber: input.pullRequestNumber,
    headSha: context.headSha,
    files,
    analyses,
    index,
    maxFiles: input.maxFiles,
  });

  const noModel = process.env.CODEBOT_NO_MODEL === "1";
  const swarmConfig = input.swarmConfig ?? resolveCodeBotSwarmConfig();
  const tracker = input.usageTracker ?? createCodeBotUsageTracker(swarmConfig);
  const hypothesisReport =
    input.hypothesisReport ??
    (await buildHypothesisReport({
      repository: repository.fullName,
      pullRequestNumber: input.pullRequestNumber,
      headSha: context.headSha,
      title: context.title,
      body: context.body,
      files,
      analyses,
      index,
      maxFiles: input.maxFiles,
      maxHypotheses: input.maxHypotheses,
      modelClient: input.modelClient === undefined ? (noModel ? null : undefined) : input.modelClient,
      swarmClient: input.swarmClient === undefined ? (noModel ? null : undefined) : input.swarmClient,
      modelConfig: input.modelConfig,
      swarmConfig: input.swarmConfig,
      installationId: context.installationId,
      fullName: context.fullName,
      usageTracker: tracker,
      onLog: input.onLog,
      signal: input.signal,
    }));

  const fixReport = await buildFixReport({
    repository: repository.fullName,
    pullRequestNumber: input.pullRequestNumber,
    headSha: context.headSha,
    title: context.title,
    hypotheses: hypothesisReport.hypotheses,
    files,
    patches: parsePatches(files),
    analyses,
    report,
    index,
    installationId: context.installationId,
    fullName: context.fullName,
    maxFixes: input.maxFixes,
    severities: input.severities,
    coordinatorClient: input.modelClient === undefined ? (noModel ? null : undefined) : input.modelClient,
    codegenClient: input.codegenClient === undefined ? (noModel ? null : undefined) : input.codegenClient,
    modelConfig: input.modelConfig,
    swarmConfig,
    readFile: input.readFile,
    searchCode: input.searchCode,
    usageTracker: tracker,
    onLog: input.onLog,
    signal: input.signal,
  });

  let commentId: number | null = null;
  let commentUrl: string | null = null;
  let replacedComments = 0;
  let body = buildFixesComment({ report: fixReport, runId: input.runId, version: CODEBOT_VERSION });
  if (!input.dryRun && !input.deferSuggestions) {
    fixReport.suggestions = await replaceCodeBotSuggestions({
      installationId: context.installationId,
      fullName: context.fullName,
      pullRequestNumber: input.pullRequestNumber,
      headSha: context.headSha,
      fixes: fixReport.fixes,
      body: DRAFT_SUGGESTION_BODY,
      label: "CodeBot draft fix — not sandbox-verified",
    })
      .then((replaced) => ({ posted: replaced.posted, skipped: replaced.skipped }))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        fixReport.warnings.push(`inline suggestions unavailable (${message}); patches remain in the comment`);
        return { posted: 0, skipped: 0, error: message };
      });
    body = buildFixesComment({ report: fixReport, runId: input.runId, version: CODEBOT_VERSION });
  }
  if (!input.dryRun && input.publish !== false) {
    body = buildFixesComment({ report: fixReport, runId: input.runId, version: CODEBOT_VERSION });
    const published = await publishCodeBotComment({
      installationId: context.installationId,
      fullName: context.fullName,
      pullRequestNumber: input.pullRequestNumber,
      marker: FIXES_MARKER,
      body,
    });
    commentId = published.id;
    commentUrl = published.url;
    replacedComments = published.replaced;
  }

  const considered =
    fixReport.totals.available > fixReport.totals.hypotheses
      ? `${fixReport.totals.hypotheses}/${fixReport.totals.available}`
      : `${fixReport.totals.hypotheses}`;
  const summary = `${fixReport.totals.generated} draft fix(es) · ${considered} hypothesis(es) · $${fixReport.usage.totalCostUsd.toFixed(4)}`;
  return {
    stage: "fixes",
    version: CODEBOT_VERSION,
    durationMs: Date.now() - started,
    headSha: context.headSha,
    summary,
    body,
    commentId,
    commentUrl,
    replacedComments,
    report: fixReport,
    hypothesisReport,
  };
}


