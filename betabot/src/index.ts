import { randomUUID } from "node:crypto";
import type { Repository } from "@shared/schema";
import { storage } from "../../server/storage.ts";
import { buildCodegraphReport, type BuildCodegraphReportInput } from "./codegraph.ts";
import { publishBetabotComment } from "./github.ts";
import { buildCodegraphComment, buildReviewComment, CODEGRAPH_MARKER, REVIEW_MARKER } from "./markdown.ts";
import { analyseChangedFiles, loadChangedFiles, loadPullRequestContext, loadRepoGraphIndex } from "./run-inputs.ts";
import { runHypothesisStage } from "./hypotheses.ts";
import { replaceBetabotSuggestions, runFixesStage } from "./fixes.ts";
import { plannedSuggestions, runVerifyStage } from "./verify.ts";
import { createBetabotUsageTracker, resolveBetabotSwarmConfig } from "./model.ts";
import type {
  BetabotRunInput,
  BetabotRunReceipt,
  BetabotRunResult,
  BetabotStageName,
  BetabotStageReceipt,
  BetabotStageResult,
  FixReport,
  HypothesisReport,
  ModelUsage,
  VerifyReport,
} from "./types.ts";
import { BETABOT_STAGES } from "./types.ts";
import { BETABOT_VERSION } from "./version.ts";

export { BETABOT_VERSION } from "./version.ts";
export { buildCodegraphReport } from "./codegraph.ts";
export { buildCodegraphComment, buildHypothesesComment, buildFixesComment, BETABOT_MARKER, CODEGRAPH_MARKER, HYPOTHESES_MARKER, FIXES_MARKER } from "./markdown.ts";
export { listBetabotComments, publishBetabotComment } from "./github.ts";
export { scanHypotheses, conditionRule } from "./rules.ts";
export { runAssignmentPlanner, runSynthesis, mergeHypotheses, parseModelHypotheses, dedupeHypotheses, sameFinding } from "./master.ts";
export { runSwarm, fallbackAssignments } from "./swarm.ts";
export { buildHypothesisReport, runHypothesisStage } from "./hypotheses.ts";
export { buildFixReport, runFixesStage, runFixPlanner, runCodegenAgent, parseFixPlans, validateFixEdits, replaceBetabotSuggestions } from "./fixes.ts";
export { buildVerifyReport, runVerifyStage, runVerifyLoop, runVerifyPlanner, runVerifyRepair, parseVerifyPlan, selectVerifyFixes } from "./verify.ts";
export {
  createE2bSandbox,
  clonePullRequest,
  detectInstallCommand,
  fallbackVerifyPlan,
  applyEditsToFiles,
  applyEditsToSandbox,
  resetWorktree,
  runSandboxCommands,
  redact,
  type VerifySandbox,
} from "./sandbox.ts";
export { renderFixDiff } from "./patch.ts";
export type * from "./types.ts";

export interface CodegraphStageInput {
  runId: string;
  repository: Repository;
  pullRequestNumber: number;
  dryRun?: boolean;
  /** Codegraph is internal: `runBetabot` always disables its comment. */
  publish?: boolean;
  maxFiles?: number;
}

export async function runCodegraphStage(input: CodegraphStageInput): Promise<BetabotStageResult> {
  const started = Date.now();
  const { repository } = input;
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

  const reportInput: BuildCodegraphReportInput = {
    repository: repository.fullName,
    pullRequestNumber: input.pullRequestNumber,
    headSha: context.headSha,
    files,
    analyses,
    index,
    maxFiles: input.maxFiles,
  };
  const report = buildCodegraphReport(reportInput);
  const body = buildCodegraphComment({ report, runId: input.runId, version: BETABOT_VERSION });

  let commentId: number | null = null;
  let commentUrl: string | null = null;
  let replacedComments = 0;
  if (!input.dryRun && input.publish !== false) {
    const published = await publishBetabotComment({
      installationId: context.installationId,
      fullName: context.fullName,
      pullRequestNumber: input.pullRequestNumber,
      marker: CODEGRAPH_MARKER,
      body,
    });
    commentId = published.id;
    commentUrl = published.url;
    replacedComments = published.replaced;
  }

  const summary =
    `${report.totals.files} changed file(s) · ${report.totals.symbols} symbol(s) · ` +
    `${report.totals.callers} caller(s) · ${report.totals.tests} likely test(s)`;

  return {
    stage: "codegraph",
    version: BETABOT_VERSION,
    durationMs: Date.now() - started,
    headSha: context.headSha,
    summary,
    body,
    commentId,
    commentUrl,
    replacedComments,
  };
}

export async function runBetabot(input: BetabotRunInput): Promise<BetabotRunResult> {
  const runId = input.runId ?? `betabot-${randomUUID().slice(0, 8)}`;
  const repository = await storage.getRepositoryById(input.repositoryId);
  if (!repository) throw new Error(`repository not found: ${input.repositoryId}`);

  const stages: BetabotStageName[] = input.stages?.length ? input.stages : BETABOT_STAGES;
  const results: BetabotStageResult[] = [];
  // One tracker for the whole run: stage 2 and stage 3 share one ceiling and
  // stage 4 keeps its reserved slice.
  const swarmConfig = resolveBetabotSwarmConfig();
  const usageTracker = createBetabotUsageTracker(swarmConfig);
  let hypothesisReport: HypothesisReport | undefined;
  let fixReport: FixReport | undefined;
  let verifyReport: VerifyReport | undefined;
  let runUsage: ModelUsage | undefined;
  for (const stage of stages) {
    if (stage === "codegraph") {
      results.push(
        await runCodegraphStage({
          runId,
          repository,
          pullRequestNumber: input.pullRequestNumber,
          dryRun: input.dryRun,
          publish: false,
          maxFiles: input.maxFiles,
        }),
      );
      continue;
    }
    if (stage === "hypotheses") {
      const hypothesisStage = await runHypothesisStage({
        runId,
        repository,
        pullRequestNumber: input.pullRequestNumber,
        dryRun: input.dryRun,
        publish: false,
        maxFiles: input.maxFiles,
        swarmConfig,
        usageTracker,
      });
      hypothesisReport = hypothesisStage.report;
      runUsage = hypothesisStage.report.usage;
      results.push(hypothesisStage);
      continue;
    }
    if (stage === "fixes") {
      const fixesStage = await runFixesStage({
        runId,
        repository,
        pullRequestNumber: input.pullRequestNumber,
        dryRun: input.dryRun,
        publish: false,
        deferSuggestions: true,
        maxFiles: input.maxFiles,
        hypothesisReport,
        swarmConfig,
        usageTracker,
      });
      fixReport = fixesStage.report;
      hypothesisReport ??= fixesStage.hypothesisReport;
      runUsage = fixesStage.report.usage;
      results.push(fixesStage);
      continue;
    }
    if (stage === "verify") {
      const verifyStage = await runVerifyStage({
        runId,
        repository,
        pullRequestNumber: input.pullRequestNumber,
        dryRun: input.dryRun,
        publish: false,
        deferSuggestions: true,
        maxFiles: input.maxFiles,
        hypothesisReport,
        fixReport,
        swarmConfig,
        usageTracker,
      });
      verifyReport = verifyStage.report;
      fixReport ??= verifyStage.fixReport;
      hypothesisReport ??= verifyStage.hypothesisReport;
      runUsage = verifyStage.report.usage;
      results.push(verifyStage);
      continue;
    }
    throw new Error(`unknown stage: ${String(stage)}`);
  }

  // One review comment for the run, published before the suggestion review so
  // the conversation reads findings first and inline suggestions second. The
  // marker matches every legacy per-stage comment, so publishing it replaces
  // all of them at once.
  const publishable = Boolean(hypothesisReport || fixReport || verifyReport);
  const suggestionPlan = plannedSuggestions({ verifyReport, fixReport });
  if (suggestionPlan && !suggestionPlan.verified && !verifyReport && fixReport) {
    fixReport.warnings.push("sandbox verification did not run; the drafts are posted unverified");
  }
  const buildBody = () =>
    publishable
      ? buildReviewComment({
          hypothesisReport,
          fixReport,
          verifyReport,
          severities: swarmConfig.fixSeverities,
          runId,
          version: BETABOT_VERSION,
        })
      : "";
  let body = buildBody();
  let commentId: number | null = null;
  let commentUrl: string | null = null;
  let replacedComments = 0;
  const context = !input.dryRun && publishable ? await loadPullRequestContext(repository, input.pullRequestNumber) : undefined;
  if (context) {
    const published = await publishBetabotComment({
      installationId: context.installationId,
      fullName: context.fullName,
      pullRequestNumber: input.pullRequestNumber,
      marker: REVIEW_MARKER,
      body,
    });
    commentId = published.id;
    commentUrl = published.url;
    replacedComments = published.replaced;
  }
  if (context && suggestionPlan) {
    try {
      const replaced = await replaceBetabotSuggestions({
        installationId: context.installationId,
        fullName: context.fullName,
        pullRequestNumber: input.pullRequestNumber,
        headSha: verifyReport?.headSha ?? fixReport?.headSha ?? results[0]?.headSha ?? "",
        fixes: suggestionPlan.fixes,
        body: suggestionPlan.body,
        label: suggestionPlan.label,
      });
      const suggestions = { posted: replaced.posted, skipped: replaced.skipped, removed: replaced.removed };
      if (verifyReport) verifyReport.suggestions = suggestions;
      else if (fixReport) {
        fixReport.suggestions = { posted: replaced.posted, skipped: replaced.skipped };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const target = verifyReport ?? fixReport;
      if (target) {
        target.warnings.push(`inline suggestions unavailable (${message}); the patches remain in the comment`);
        body = buildBody();
        const republished = await publishBetabotComment({
          installationId: context.installationId,
          fullName: context.fullName,
          pullRequestNumber: input.pullRequestNumber,
          marker: REVIEW_MARKER,
          body,
        });
        commentId = republished.id;
        commentUrl = republished.url;
        replacedComments += republished.replaced;
      }
    }
  }

  const stageReceipts: BetabotStageReceipt[] = results.map((result) => ({
    stage: result.stage,
    status: "ok",
    durationMs: result.durationMs,
    summary: result.summary,
    commentId: result.commentId,
    usage: "report" in result ? (result as { report?: { usage?: ModelUsage } }).report?.usage : undefined,
  }));
  const receipt: BetabotRunReceipt = {
    runId,
    version: BETABOT_VERSION,
    repository: repository.fullName,
    pullRequestNumber: input.pullRequestNumber,
    headSha: results[0]?.headSha ?? "",
    commentId,
    targetCostUsd: usageTracker.targetCostUsd,
    maxCostUsd: usageTracker.maxCostUsd,
    reserveUsd: usageTracker.reserveUsd,
    totalCostUsd: usageTracker.totalCostUsd,
    totalCalls: usageTracker.totalCalls,
    cacheHitRate: runUsage && runUsage.coordinator.tokensIn + runUsage.swarm.tokensIn + runUsage.codegen.tokensIn > 0
      ? (runUsage.coordinator.cachedTokensIn + runUsage.swarm.cachedTokensIn + runUsage.codegen.cachedTokensIn) /
        (runUsage.coordinator.tokensIn + runUsage.swarm.tokensIn + runUsage.codegen.tokensIn)
      : 0,
    stages: stageReceipts,
  };
  const failedCalls =
    (runUsage?.coordinator.failedCalls ?? 0) + (runUsage?.swarm.failedCalls ?? 0) + (runUsage?.codegen.failedCalls ?? 0);
  if (failedCalls > 0) {
    console.warn(`[betabot] ${failedCalls} model call(s) failed before completing this run`);
  }
  // One JSON line per run so cost is recorded outside the replaceable comments.
  console.log(`BETABOT_RECEIPT ${JSON.stringify(receipt)}`);

  return {
    runId,
    version: BETABOT_VERSION,
    repository: repository.fullName,
    pullRequestNumber: input.pullRequestNumber,
    headSha: results[0]?.headSha ?? "",
    published: commentUrl !== null,
    commentId,
    commentUrl,
    body,
    usage: runUsage,
    receipt,
    stages: results,
  };
}
