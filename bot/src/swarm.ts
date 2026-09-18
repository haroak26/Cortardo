/**
 * Swarm: read-only investigators, one per assignment, in parallel. Each agent
 * reads the real code through the GitHub API (plus the diff and the stored
 * graph), then reports evidence-backed hypotheses. One agent failing never
 * fails the run.
 */
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import * as githubApi from "../../server/lib/github/api.ts";
import { runAgent } from "./agent.ts";
import { executeReadTool, READ_TOOL_NAMES, type ReadToolContext } from "./tools.ts";
import { matchLead, parseModelHypotheses, renderGraphEvidence, toHypothesis } from "./master.ts";
import { renderChangedPatches, type ParsedPatch } from "./patch.ts";
import { swarmSystem, swarmUser } from "./prompts.ts";
import { CodeBotUsageCollectingClient, type CodeBotModelClient, type CodeBotSwarmConfig } from "./model.ts";
import type {
  CodegraphChangedFile,
  CodegraphReport,
  Hypothesis,
  HypothesisDismissal,
  RepoGraphIndex,
  SwarmAgentReport,
  SwarmAssignment,
} from "./types.ts";

const MAX_SWARM_HYPOTHESES_PER_AGENT = 2;
const MAX_AGENT_DIFF_CHARS = 14_000;
const MAX_SWEEP_FILES = 3;
const MAX_SWEEP_PATCH_CHARS = 30_000;
const DEFAULT_MAX_SWEEPS = 2;

const SKIP_FILE =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|poetry\.lock)$|\.min\.(js|css)$|(^|\/)\.(dist|vendor|node_modules|__snapshots__)\//i;
const DOC_FILE = /\.(md|mdx|txt|rst)$/i;

export function sweepableFiles(files: CodegraphChangedFile[]): CodegraphChangedFile[] {
  return files.filter(
    (file) => file.status !== "removed" && Boolean(file.patch) && !SKIP_FILE.test(file.path) && !DOC_FILE.test(file.path),
  );
}

function sweepable(file: CodegraphChangedFile): boolean {
  return sweepableFiles([file]).length > 0;
}

/**
 * True when the file's added lines change behavior. Comment-, string- and
 * rename-only files leak nothing the graph comment does not already show, so
 * they do not earn a model agent.
 */
export function hasBehavioralAddedLines(patch: string | undefined): boolean {
  if (!patch) return false;
  for (const raw of patch.split("\n")) {
    if (!raw.startsWith("+") || raw.startsWith("+++")) continue;
    const line = raw.slice(1).trim();
    if (!line || line.startsWith("//") || line.startsWith("#") || line.startsWith("/*") || line.startsWith("*")) continue;
    if (/^[{}()[\],;]+$/.test(line)) continue;
    if (/[=<>]|==|\bif\b|\bfor\b|\bwhile\b|\bcatch\b|\bawait\b|\breturn\b|\bthrow\b|\btry\b|\(/.test(line)) return true;
  }
  return false;
}

function directoryOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "." : path.slice(0, index);
}

/**
 * Group uncovered behavioral files into module-coherent sweep assignments.
 * Every file is still covered, but one agent handles a directory instead of
 * one agent per file.
 */
function sweepGroups(
  remaining: CodegraphChangedFile[],
  maxSweeps: number,
): CodegraphChangedFile[][] {
  const groups: CodegraphChangedFile[][] = [];
  for (const file of remaining) {
    const directory = directoryOf(file.path);
    const current = groups[groups.length - 1];
    if (
      current &&
      directoryOf(current[0].path) === directory &&
      current.length < MAX_SWEEP_FILES &&
      current.reduce((total, entry) => total + (entry.patch?.length ?? 0), 0) + (file.patch?.length ?? 0) <= MAX_SWEEP_PATCH_CHARS
    ) {
      current.push(file);
      continue;
    }
    if (groups.length >= maxSweeps) {
      // Fold the file into the last group even across directories; coverage
      // beats tidiness once the sweep cap is reached.
      groups[groups.length - 1].push(file);
      continue;
    }
    groups.push([file]);
  }
  return groups;
}

function appendSweeps(
  assignments: SwarmAssignment[],
  remaining: CodegraphChangedFile[],
  maxAgents: number,
  maxSweeps: number,
): SwarmAssignment[] {
  const groups = sweepGroups(remaining, maxSweeps);
  for (const group of groups) {
    if (assignments.length >= maxAgents) break;
    const label = group.length === 1 ? group[0].path : `${directoryOf(group[0].path)} (${group.length} files)`;
    assignments.push({
      id: `a${assignments.length + 1}`,
      kind: "sweep",
      files: group.map((file) => file.path),
      leads: [],
      focus:
        `Review the behavioral changes in ${label} for defects the graph alone cannot show. ` +
        `Files: ${group.map((file) => `${file.path} (+${file.additions}/-${file.deletions})`).join(", ")}.`,
    });
  }
  return assignments;
}

/** Deterministic fallback plan when the coordinator cannot plan. */
export function fallbackAssignments(input: {
  files: CodegraphChangedFile[];
  leads: Hypothesis[];
  maxAgents: number;
  maxSweeps?: number;
}): SwarmAssignment[] {
  const assignments: SwarmAssignment[] = [];
  const byFile = new Map<string, Hypothesis[]>();
  for (const lead of input.leads) {
    const bucket = byFile.get(lead.file) ?? [];
    bucket.push(lead);
    byFile.set(lead.file, bucket);
  }
  for (const [file, leads] of [...byFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
    if (assignments.length >= input.maxAgents) break;
    assignments.push({
      id: `a${assignments.length + 1}`,
      kind: "lead",
      files: [file],
      leads: leads.slice(0, 6).map((lead) => lead.id),
      focus: `Verify the deterministic leads in ${file} against the real code and report only what the evidence supports.`,
    });
  }
  const covered = new Set(assignments.flatMap((assignment) => assignment.files));
  const remaining = uncoveredBehavioralFiles(input.files, covered);
  return appendSweeps(assignments, remaining, input.maxAgents, input.maxSweeps ?? DEFAULT_MAX_SWEEPS);
}

function uncoveredBehavioralFiles(files: CodegraphChangedFile[], covered: Set<string>): CodegraphChangedFile[] {
  return files
    .filter((file) => sweepable(file) && !covered.has(file.path) && hasBehavioralAddedLines(file.patch))
    .sort((a, b) => b.additions + b.deletions - (a.additions + a.deletions));
}

/** Ensure every behavioral changed file is covered, without exceeding the cap. */
export function withCoverage(input: {
  assignments: SwarmAssignment[];
  files: CodegraphChangedFile[];
  maxAgents: number;
  maxSweeps?: number;
}): SwarmAssignment[] {
  const assignments = input.assignments.slice(0, input.maxAgents);
  const covered = new Set(assignments.flatMap((assignment) => assignment.files));
  const remaining = uncoveredBehavioralFiles(input.files, covered);
  return appendSweeps(assignments, remaining, input.maxAgents, input.maxSweeps ?? DEFAULT_MAX_SWEEPS);
}

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, Math.min(limit, queue.length)) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (item === undefined) return;
      await worker(item);
    }
  });
  await Promise.all(runners);
}

export interface SwarmRunInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  installationId: string | number;
  fullName: string;
  files: CodegraphChangedFile[];
  patches: Map<string, ParsedPatch>;
  analyses: Map<string, FileAnalysis>;
  report: CodegraphReport;
  index: RepoGraphIndex | null;
  leads: Hypothesis[];
  dismissals: HypothesisDismissal[];
  assignments: SwarmAssignment[];
  client: CodeBotModelClient;
  config: CodeBotSwarmConfig;
  deadline: number;
  budgetExhausted?: () => boolean;
  signal?: AbortSignal;
  onLog?: (message: string) => void;
  cacheKey?: string;
  /** Injectable for tests; defaults to the GitHub API at the PR head. */
  readFile?: (path: string) => Promise<string | undefined>;
  searchCode?: (query: string) => Promise<Array<{ path: string; fragments: string[] }>>;
}



export async function runSwarm(input: SwarmRunInput): Promise<SwarmAgentReport[]> {
  const contentCache = new Map<string, string | undefined>();
  const githubRead = async (path: string): Promise<string | undefined> => {
    if (contentCache.has(path)) return contentCache.get(path);
    const content = await githubApi
      .getFileContent(input.installationId, input.fullName, path, input.headSha)
      .catch(() => null);
    const value = content ?? undefined;
    contentCache.set(path, value);
    return value;
  };
  const readFile = input.readFile ?? githubRead;
  const searchCode =
    input.searchCode ??
    (input.config.searchEnabled
      ? (query: string) => githubApi.searchCode(input.installationId, input.fullName, query, 8)
      : undefined);
  const repoFiles = (input.index?.files ?? []).map((file) => file.path);

  const reports: SwarmAgentReport[] = new Array(input.assignments.length);
  const tasks = input.assignments.map((assignment, index) => ({ assignment, index }));

  await runPool(tasks, input.config.concurrency, async ({ assignment, index }) => {
    const scopedFiles = input.files.filter((file) => assignment.files.includes(file.path));
    const scopedPatches = new Map<string, ParsedPatch>();
    for (const file of scopedFiles) {
      const patch = input.patches.get(file.path);
      if (patch) scopedPatches.set(file.path, patch);
    }
    const toolContext: ReadToolContext = {
      fullName: input.fullName,
      headSha: input.headSha,
      patches: input.patches,
      analyses: input.analyses,
      report: input.report,
      repoFiles,
      readFile,
      searchCode,
      signal: input.signal,
    };
    const assignmentLeads = input.leads.filter((lead) => assignment.leads.includes(lead.id));

    try {
      if (input.budgetExhausted?.()) {
        reports[index] = {
          assignmentId: assignment.id,
          hypotheses: [],
          checked: [],
          dropped: 0,
          toolCalls: 0,
          turns: 0,
          stoppedReason: "skipped",
          failure: "model cost budget exhausted before this assignment started",
        };
        return;
      }
      const groundingFile =
        assignment.files.find((path) => {
          const patch = input.patches.get(path);
          return patch !== undefined && patch.added.size > 0;
        }) ?? assignment.files[0];
      const agentClient = new CodeBotUsageCollectingClient(input.client);
      const result = await runAgent({
        system: swarmSystem(),
        user: swarmUser({
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          title: input.title,
          headSha: input.headSha,
          assignment,
          fileDiffs: renderChangedPatches(scopedFiles, MAX_AGENT_DIFF_CHARS),
          graphEvidence: renderGraphEvidence({ ...input.report, files: input.report.files.filter((file) => assignment.files.includes(file.path)) }),
          leads: assignmentLeads,
          dismissals: input.dismissals,
        }),
        tools: READ_TOOL_NAMES,
        execute: (action) => executeReadTool(action, toolContext),
        client: agentClient,
        maxTurns: input.config.maxTurns,
        maxToolsPerTurn: input.config.maxToolsPerTurn,
        deadline: input.deadline,
        minToolCallsBeforeFinal: 1,
        groundingAction: groundingFile ? { tool: "read_diff", args: { path: groundingFile } } : undefined,
        label: `swarm-${assignment.id}`,
        onLog: input.onLog,
        signal: input.signal,
        isFinal: (parsed) => Array.isArray(parsed.hypotheses),
        cacheKey: input.cacheKey,
        stopWhenNoNewEvidence: true,
      });

      const raw = JSON.stringify(result.final ?? {});
      const { hypotheses, dropped } = parseModelHypotheses(raw, {
        files: input.files,
        patches: input.patches,
        maxHypotheses: MAX_SWARM_HYPOTHESES_PER_AGENT,
      });
      const mapped = hypotheses.map((entry) => toHypothesis(entry, matchLead(entry, assignmentLeads)));
      const checked = Array.isArray(result.final?.checked)
        ? (result.final!.checked as unknown[]).filter((entry): entry is string => typeof entry === "string").slice(0, 12)
        : [];
      reports[index] = {
        assignmentId: assignment.id,
        hypotheses: mapped,
        checked,
        dropped,
        toolCalls: result.toolCalls,
        turns: result.turns,
        usage: agentClient.usage,
        stoppedReason: result.stoppedReason,
      };
    } catch (error) {
      reports[index] = {
        assignmentId: assignment.id,
        hypotheses: [],
        checked: [],
        dropped: 0,
        toolCalls: 0,
        turns: 0,
        stoppedReason: "failed",
        failure: error instanceof Error ? error.message : String(error),
      };
    }
  });

  return reports.filter((report): report is SwarmAgentReport => report !== undefined);
}
