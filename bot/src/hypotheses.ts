/**
 * Hypotheses stage: deterministic rules produce grounded leads, the coordinator
 * plans assignments, GPT 5 Nano swarm agents read the real code to confirm or kill
 * them, and the coordinator synthesizes the final ranked list. Everything
 * published is an unproven advisory — later stages prove or fix. The stage is
 * honest when the model is unavailable and falls back to the deterministic
 * leads (and to whatever evidence was gathered before a failure).
 */
import type { Repository } from "@shared/schema";
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import { storage } from "../../server/storage.ts";
import { buildCodegraphReport } from "./codegraph.ts";
import { publishCodeBotComment } from "./github.ts";
import { applyDismissals, dismissalOf } from "./learnings.ts";
import { buildHypothesesComment, HYPOTHESES_MARKER } from "./markdown.ts";
import {
  dedupeHypotheses,
  matchLead,
  mergeHypotheses,
  patchesFor,
  runAssignmentPlanner,
  runSynthesis,
  toHypothesis,
} from "./master.ts";
import {
  BudgetedModelClient,
  codeBotCacheKey,
  createCodeBotModelClient,
  createCodeBotUsageTracker,
  resolveCodeBotModelConfig,
  resolveCodeBotSwarmConfig,
  swarmModelConfig,
  type CodeBotModelClient,
  type CodeBotModelConfig,
  type CodeBotSwarmConfig,
  type CodeBotUsageTracker,
} from "./model.ts";
import { scanHypotheses } from "./rules.ts";
import { analyseChangedFiles, loadChangedFiles, loadPullRequestContext, loadRepoGraphIndex } from "./run-inputs.ts";
import { fallbackAssignments, hasBehavioralAddedLines, runSwarm, sweepableFiles, withCoverage } from "./swarm.ts";
import type {
  CodegraphChangedFile,
  Hypothesis,
  HypothesisDismissal,
  HypothesisReport,
  HypothesisSeverity,
  HypothesisStageResult,
  ModelUsage,
  RepoGraphIndex,
  SwarmAgentReport,
  SwarmAssignment,
} from "./types.ts";
import { CODEBOT_VERSION } from "./version.ts";

export const MAX_HYPOTHESES = 8;

export interface BuildHypothesisReportInput {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  title?: string;
  body?: string;
  files: CodegraphChangedFile[];
  analyses: Map<string, FileAnalysis>;
  index: RepoGraphIndex | null;
  maxFiles?: number;
  maxHypotheses?: number;
  /** Coordinator client; `null` forces deterministic-only. */
  modelClient?: CodeBotModelClient | null;
  /** Swarm client; `null` disables the swarm tier. */
  swarmClient?: CodeBotModelClient | null;
  modelConfig?: CodeBotModelConfig;
  swarmConfig?: CodeBotSwarmConfig;
  dismissals?: HypothesisDismissal[];
  /** GitHub coordinates for the swarm read tools; defaults to the repository name. */
  installationId?: string | number;
  fullName?: string;
  /** Injectable read tools for tests; default to the GitHub API at the head SHA. */
  readFile?: (path: string) => Promise<string | undefined>;
  searchCode?: (query: string) => Promise<Array<{ path: string; fragments: string[] }>>;
  /** Run-level budget shared with stage 3; created when absent. */
  usageTracker?: CodeBotUsageTracker;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

function countSeverities(hypotheses: Hypothesis[]): HypothesisReport["totals"] {
  const count = (severity: HypothesisSeverity) => hypotheses.filter((hypothesis) => hypothesis.severity === severity).length;
  return {
    hypotheses: hypotheses.length,
    critical: count("critical"),
    high: count("high"),
    medium: count("medium"),
    low: count("low") + count("info"),
  };
}

function deterministicUsage(configured: CodeBotModelConfig, reason: string): ModelUsage {
  return {
    coordinator: { id: configured.model, calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, failedCalls: 0 },
    swarm: { id: configured.swarmModel, calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, failedCalls: 0 },
    codegen: { id: configured.codegenModel, calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, failedCalls: 0 },
    totalCostUsd: 0,
    maxCostUsd: 0,
    used: false,
    reason,
  };
}

export async function buildHypothesisReport(input: BuildHypothesisReportInput): Promise<HypothesisReport> {
  const maxHypotheses = input.maxHypotheses ?? MAX_HYPOTHESES;
  const configured = input.modelConfig ?? resolveCodeBotModelConfig();
  const swarmConfig = input.swarmConfig ?? resolveCodeBotSwarmConfig();
  const report = buildCodegraphReport({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    files: input.files,
    analyses: input.analyses,
    index: input.index,
    maxFiles: input.maxFiles,
  });
  const patches = patchesFor(input.files);
  const scan = scanHypotheses({
    files: input.files,
    analyses: input.analyses,
    report,
    maxHypotheses,
  });

  const warnings = [...scan.warnings, ...report.warnings.filter((warning) => /index is at/.test(warning))];
  let hypotheses = scan.hypotheses;
  let usage: ModelUsage;

  const behavioral = sweepableFiles(input.files).filter((file) => hasBehavioralAddedLines(file.patch));
  const coordinatorCacheKey = codeBotCacheKey("coordinator", input);
  const swarmCacheKey = codeBotCacheKey("swarm", input);

  if (input.modelClient === null) {
    usage = deterministicUsage(configured, "model disabled for this run (CODEBOT_NO_MODEL)");
  } else if (!input.modelClient && !configured.apiKey) {
    usage = deterministicUsage(configured, "no gateway key configured; deterministic leads only");
  } else if (scan.hypotheses.length === 0 && behavioral.length === 0) {
    usage = deterministicUsage(configured, "no leads or behavioral files to investigate; model tiers skipped");
    warnings.push("no leads or behavioral files to investigate; the model tiers were skipped");
  } else {
    const tracker = input.usageTracker ?? createCodeBotUsageTracker(swarmConfig);
    tracker.beginStage("hypotheses", swarmConfig.stage2BudgetUsd);
    const coordinator = new BudgetedModelClient(
      input.modelClient ?? createCodeBotModelClient(configured),
      tracker,
      "coordinator",
      { modelId: configured.model, maxOutputTokens: configured.maxTokens },
    );
    const swarmEnabled = input.swarmClient !== null;
    const swarm = swarmEnabled
      ? new BudgetedModelClient(
          input.swarmClient ?? createCodeBotModelClient(swarmModelConfig(configured)),
          tracker,
          "swarm",
          { modelId: configured.swarmModel, maxOutputTokens: configured.swarmMaxTokens ?? configured.maxTokens },
        )
      : undefined;
    let modelError: string | undefined;
    let swarmReports: SwarmAgentReport[] = [];

    try {
      if (swarm) {
        let assignments: SwarmAssignment[] = [];
        try {
          const plan = await runAssignmentPlanner({
            repository: input.repository,
            pullRequestNumber: input.pullRequestNumber,
            title: input.title ?? "",
            body: input.body,
            headSha: input.headSha,
            report,
            files: input.files,
            leads: scan.hypotheses,
            dismissals: input.dismissals ?? [],
            maxAgents: swarmConfig.maxAgents,
            client: coordinator,
            signal: input.signal,
            cacheKey: coordinatorCacheKey,
          });
          assignments = plan.assignments;
          warnings.push(...plan.warnings);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          modelError ??= reason;
          warnings.push(`coordinator plan failed (${reason}); using the deterministic assignment plan`);
        }
        if (assignments.length === 0) {
          assignments = fallbackAssignments({
            files: input.files,
            leads: scan.hypotheses,
            maxAgents: swarmConfig.maxAgents,
          });
        }
        assignments = withCoverage({ assignments, files: input.files, maxAgents: swarmConfig.maxAgents });
        input.onLog?.(`hypotheses: ${assignments.length} assignment(s) planned`);
        swarmReports = await runSwarm({
          repository: input.repository,
          pullRequestNumber: input.pullRequestNumber,
          title: input.title ?? "",
          headSha: input.headSha,
          installationId: input.installationId ?? 0,
          fullName: input.fullName ?? input.repository,
          files: input.files,
          patches,
          analyses: input.analyses,
          report,
          index: input.index,
          leads: scan.hypotheses,
          dismissals: input.dismissals ?? [],
          assignments,
          client: swarm,
          config: swarmConfig,
          deadline: Date.now() + swarmConfig.timeoutMs,
          budgetExhausted: () => tracker.exhausted,
          signal: input.signal,
          onLog: input.onLog,
          cacheKey: swarmCacheKey,
          readFile: input.readFile,
          searchCode: input.searchCode,
        });
        for (const swarmReport of swarmReports) {
          if (swarmReport.failure) warnings.push(`swarm ${swarmReport.assignmentId}: ${swarmReport.failure}`);
          else if (swarmReport.dropped > 0) warnings.push(`swarm ${swarmReport.assignmentId}: dropped ${swarmReport.dropped} invalid hypothesis(es)`);
        }
      } else {
        warnings.push("swarm unavailable; the coordinator synthesized the deterministic leads alone");
      }

      const swarmHypotheses = swarmReports.flatMap((swarmReport) => swarmReport.hypotheses);
      const nothingToSynthesize =
        scan.hypotheses.length === 0 && swarmHypotheses.length === 0 && swarmReports.every((report) => !report.failure);
      let synthesis: Hypothesis[] = [];
      if (nothingToSynthesize) {
        input.onLog?.("hypotheses: no findings to synthesize; skipped the coordinator synthesis call");
      } else {
        try {
          const result = await runSynthesis({
            repository: input.repository,
            pullRequestNumber: input.pullRequestNumber,
            title: input.title ?? "",
            headSha: input.headSha,
            leads: scan.hypotheses,
            reports: swarmReports,
            dismissals: input.dismissals ?? [],
            maxHypotheses,
            files: input.files,
            patches,
            client: coordinator,
            signal: input.signal,
            cacheKey: coordinatorCacheKey,
          });
          synthesis = result.entries.map((entry) => toHypothesis(entry, matchLead(entry, scan.hypotheses)));
          warnings.push(...result.warnings);
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          modelError ??= reason;
          warnings.push(`coordinator synthesis failed (${reason}); merged the available evidence deterministically`);
        }
      }

      hypotheses = mergeHypotheses({
        leads: scan.hypotheses,
        swarm: swarmHypotheses,
        synthesis,
        maxHypotheses,
      });
      usage = {
        coordinator: { ...tracker.usage.coordinator },
        swarm: { ...tracker.usage.swarm },
        codegen: { ...tracker.usage.codegen },
        totalCostUsd: tracker.totalCostUsd,
        maxCostUsd: tracker.maxCostUsd,
        used: tracker.totalCalls > 0,
        reason: tracker.totalCalls > 0 ? undefined : modelError ? `model call failed: ${modelError}` : "no model call completed",
      };
      if (tracker.exhausted) warnings.push(`model cost budget reached ($${swarmConfig.maxCostUsd.toFixed(2)}); stopped starting new agents`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      warnings.push(`model tiers unavailable (${reason}); published deterministic leads only`);
      usage = deterministicUsage(configured, `model call failed: ${reason}`);
    }
  }

  const dismissals = swarmConfig.learningsEnabled ? (input.dismissals ?? []) : [];
  const { kept, suppressed } = applyDismissals(hypotheses, dismissals);
  if (suppressed.length > 0) {
    warnings.push(`noise filter: suppressed ${suppressed.length} previously dismissed hypothesis(es)`);
  }

  // One bug appears exactly once, then priorities are renumbered in order so
  // stage 3 plans one fix per hypothesis.
  const { hypotheses: unique, deduped } = dedupeHypotheses(kept);
  if (deduped > 0) warnings.push(`merged ${deduped} duplicate finding(s)`);
  hypotheses = unique.map((hypothesis, index) => ({ ...hypothesis, priority: index + 1 }));

  return {
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    indexCommitSha: report.indexCommitSha,
    hypotheses,
    totals: countSeverities(hypotheses),
    usage,
    dismissed: suppressed.length,
    deduped,
    warnings,
  };
}

export interface HypothesisStageInput {
  runId: string;
  repository: Repository;
  pullRequestNumber: number;
  dryRun?: boolean;
  /** false defers publishing to the pipeline's single review comment. */
  publish?: boolean;
  maxFiles?: number;
  maxHypotheses?: number;
  /** Injectable for tests; omit to build from the environment, `null` to skip. */
  modelClient?: CodeBotModelClient | null;
  swarmClient?: CodeBotModelClient | null;
  modelConfig?: CodeBotModelConfig;
  swarmConfig?: CodeBotSwarmConfig;
  /** Run-level budget shared with stage 3; created when absent. */
  usageTracker?: CodeBotUsageTracker;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

async function loadDismissals(repository: Repository): Promise<HypothesisDismissal[]> {
  const rows = await storage.listRepositoryLearnings(repository.workspaceId, repository.id).catch(() => []);
  return rows
    .map((row) => dismissalOf({ findingKey: row.findingKey, text: row.text, path: row.path }))
    .filter((entry): entry is HypothesisDismissal => entry !== undefined);
}

export async function runHypothesisStage(input: HypothesisStageInput): Promise<HypothesisStageResult> {
  const started = Date.now();
  const repository = input.repository;
  const swarmConfig = input.swarmConfig ?? resolveCodeBotSwarmConfig();
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
  const dismissals = swarmConfig.learningsEnabled ? await loadDismissals(repository) : [];

  const noModel = process.env.CODEBOT_NO_MODEL === "1";
  const modelClient = input.modelClient === undefined ? (noModel ? null : undefined) : input.modelClient;
  const swarmClient = input.swarmClient === undefined ? (noModel ? null : undefined) : input.swarmClient;
  const report = await buildHypothesisReport({
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
    modelClient,
    swarmClient,
    modelConfig: input.modelConfig,
    swarmConfig,
    dismissals,
    installationId: context.installationId,
    fullName: context.fullName,
    usageTracker: input.usageTracker,
    onLog: input.onLog,
    signal: input.signal,
  });

  const body = buildHypothesesComment({ report, runId: input.runId, version: CODEBOT_VERSION });

  let commentId: number | null = null;
  let commentUrl: string | null = null;
  let replacedComments = 0;
  if (!input.dryRun && input.publish !== false) {
    const published = await publishCodeBotComment({
      installationId: context.installationId,
      fullName: context.fullName,
      pullRequestNumber: input.pullRequestNumber,
      marker: HYPOTHESES_MARKER,
      body,
    });
    commentId = published.id;
    commentUrl = published.url;
    replacedComments = published.replaced;
  }

  const highPriority = report.totals.critical + report.totals.high;
  const tierLabel = report.usage.used
    ? `coordinator ×${report.usage.coordinator.calls} · swarm ×${report.usage.swarm.calls}`
    : "deterministic only";
  const summary = `${report.totals.hypotheses} hypothesis(s) · ${highPriority} high priority · ${tierLabel}`;

  return {
    stage: "hypotheses",
    version: CODEBOT_VERSION,
    durationMs: Date.now() - started,
    headSha: context.headSha,
    summary,
    body,
    commentId,
    commentUrl,
    replacedComments,
    report,
  };
}
