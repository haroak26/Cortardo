import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../../db";
import { repositories, repositoryCodeFiles, repositoryCodegraphs, reviewFindings, reviewRuns, type Repository } from "@shared/schema";
import { storage } from "../../storage";
import * as githubApi from "../github/api";
import { getInstallationToken } from "../github/app";
import {
  createEngine,
  E2BSandboxInstance,
  ENGINE_VERSION,
  publicModelSelection,
  resolveEngineConfig,
  type EngineResult,
  type Finding,
  type RepoGraphInput,
  type ReviewRequest,
} from "../../../cortardobot/src/index.ts";
import { createLogger, redactSecrets } from "../../../cortardobot/src/util.ts";
import { resolveModelIds, resolveReasoning, type ModelRole, type ReasoningEffort } from "@shared/models";
import { autoCommitVerifiedFixes, type AutoCommitResult } from "./autocommit";
import { failCheckRun, finishCheckRun, publishReview, startReviewCheckRun } from "./publisher";

const logger = createLogger("info", "cortado-runner");
const PROCESS_ID = `runner-${randomUUID().slice(0, 8)}`;

export interface EnqueueResult {
  runId: string | null;
  /** True when an active run (or a published run) already covers this revision. */
  duplicate: boolean;
  error?: string;
}

export interface TriggerReviewInput {
  repositoryId: string;
  pullRequestNumber: number;
  trigger: "webhook" | "mention" | "manual";
  headSha?: string;
  instructions?: string;
  models?: Partial<Record<ModelRole, string>>;
  reasoning?: Partial<Record<ModelRole, ReasoningEffort>>;
  workspaceId?: string;
  userId?: string;
}

interface QueuedJob {
  runId: string;
  input: TriggerReviewInput;
}

const queue: QueuedJob[] = [];
const active = new Map<string, Promise<void>>();
const MAX_CONCURRENT = Number(process.env.CORTADO_MAX_CONCURRENT_RUNS ?? 1);
const MAX_QUEUE = Number(process.env.CORTADO_MAX_QUEUE ?? 100);
const MAX_FILE_BYTES = Number(process.env.CORTADO_MAX_FILE_BYTES ?? 400_000);
const LEASE_MS = Number(process.env.CORTADO_RUN_LEASE_MS ?? 20 * 60_000);
const HEARTBEAT_MS = Number(process.env.CORTADO_RUN_HEARTBEAT_MS ?? 30_000);
const STALE_MS = Number(process.env.CORTADO_STALE_RUN_MS ?? 15 * 60_000);
const RECOVERY_INTERVAL_MS = Number(process.env.CORTADO_RECOVERY_INTERVAL_MS ?? 2 * 60_000);
const MAX_HEARTBEAT_FAILURES = 3;

let recoveryTimer: NodeJS.Timeout | undefined;

async function existingRunForHead(input: TriggerReviewInput): Promise<boolean> {
  const base = [eq(reviewRuns.repositoryId, input.repositoryId)];
  const rows = input.headSha
    ? await db
        .select({ status: reviewRuns.status, publishState: reviewRuns.publishState })
        .from(reviewRuns)
        .where(and(...base, eq(reviewRuns.headSha, input.headSha), inArray(reviewRuns.status, ["queued", "running", "done"])))
        .limit(5)
    : await db
        .select({ status: reviewRuns.status, publishState: reviewRuns.publishState })
        .from(reviewRuns)
        .where(and(...base, eq(reviewRuns.pullRequestNumber, input.pullRequestNumber), inArray(reviewRuns.status, ["queued", "running"])))
        .limit(5);
  // A finished run whose review never published may be retried; anything else
  // (active, or published) suppresses a duplicate.
  return rows.some((row) => row.status !== "done" || row.publishState !== "published");
}

/**
 * Recover runs abandoned by a crash/restart: running runs whose lease expired
 * are marked error so the next webhook can retry them.
 */
export async function recoverStaleReviewRuns(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - STALE_MS);
    const stale = await db
      .update(reviewRuns)
      .set({
        status: "error",
        error: "Interrupted (stale run lease expired)",
        finishedAt: new Date(),
        updatedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(
        and(
          eq(reviewRuns.status, "running"),
          or(lt(reviewRuns.leaseExpiresAt, new Date()), and(isNull(reviewRuns.leaseExpiresAt), lt(reviewRuns.startedAt, cutoff))),
        ),
      )
      .returning({ id: reviewRuns.id });
    const staleQueued = await db
      .update(reviewRuns)
      .set({
        status: "error",
        error: "Interrupted before the run started (queued too long)",
        finishedAt: new Date(),
        updatedAt: new Date(),
        publishState: "failed",
        publishError: "Interrupted before the run started",
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(reviewRuns.status, "queued"), lt(reviewRuns.createdAt, cutoff)))
      .returning({ id: reviewRuns.id });
    const total = stale.length + staleQueued.length;
    if (total > 0) logger.warn(`recovered ${stale.length} stale running and ${staleQueued.length} stale queued review run(s)`);
    return total;
  } catch (error) {
    logger.error("stale run recovery failed", { error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}

function scheduleRecovery(): void {
  if (recoveryTimer) return;
  recoveryTimer = setInterval(() => void recoverStaleReviewRuns(), RECOVERY_INTERVAL_MS);
  recoveryTimer.unref?.();
  void recoverStaleReviewRuns();
}

export async function enqueueReview(input: TriggerReviewInput): Promise<EnqueueResult> {
  try {
    scheduleRecovery();
    if (await existingRunForHead(input)) {
      logger.info(`skipping duplicate review for ${input.repositoryId}#${input.pullRequestNumber}`);
      return { runId: null, duplicate: true };
    }
    if (queue.length >= MAX_QUEUE) {
      logger.error(`review queue is full (${MAX_QUEUE}); rejecting the run`);
      return { runId: null, duplicate: false, error: `review queue is full (${MAX_QUEUE})` };
    }
    const [run] = await db
      .insert(reviewRuns)
      .values({
        repositoryId: input.repositoryId,
        workspaceId: input.workspaceId,
        userId: input.userId,
        trigger: input.trigger,
        status: "queued",
        title: `Review pull request #${input.pullRequestNumber}`,
        instructions: input.instructions,
        headSha: input.headSha ?? null,
        pullRequestNumber: input.pullRequestNumber,
        engineVersion: ENGINE_VERSION,
        stats: { pullRequestNumber: input.pullRequestNumber, headSha: input.headSha ?? null, engineVersion: ENGINE_VERSION },
      })
      .returning({ id: reviewRuns.id });
    const runId = run.id;
    queue.push({ runId, input });
    pump();
    logger.info(`queued review run ${runId} for ${input.repositoryId}#${input.pullRequestNumber}`);
    return { runId, duplicate: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate key|unique/i.test(message)) {
      logger.info(`duplicate active review for ${input.repositoryId}#${input.pullRequestNumber}`);
      return { runId: null, duplicate: true };
    }
    logger.error("failed to enqueue review", { error: message });
    return { runId: null, duplicate: false, error: message };
  }
}

function pump(): void {
  while (active.size < MAX_CONCURRENT && queue.length > 0) {
    const job = queue.shift()!;
    const task = processRun(job)
      .catch((error) => logger.error(`review run ${job.runId} crashed`, { error: error instanceof Error ? error.message : String(error) }))
      .finally(() => {
        active.delete(job.runId);
        pump();
      });
    active.set(job.runId, task);
  }
}

async function claimRun(runId: string): Promise<boolean> {
  const claimed = await db
    .update(reviewRuns)
    .set({
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
      leaseOwner: PROCESS_ID,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      heartbeatAt: new Date(),
      leaseGeneration: sql`${reviewRuns.leaseGeneration} + 1`,
    })
    .where(and(eq(reviewRuns.id, runId), eq(reviewRuns.status, "queued")))
    .returning({ id: reviewRuns.id });
  return claimed.length > 0;
}

async function heartbeat(runId: string): Promise<boolean> {
  try {
    const rows = await db
      .update(reviewRuns)
      .set({ heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
      .where(and(eq(reviewRuns.id, runId), eq(reviewRuns.leaseOwner, PROCESS_ID)))
      .returning({ id: reviewRuns.id });
    return rows.length > 0;
  } catch (error) {
    logger.warn(`[${runId.slice(0, 8)}] heartbeat failed`, { error: error instanceof Error ? error.message : String(error) });
    return false;
  }
}

/** L0 context: the stored code graph plus per-file string references. */
async function loadRepoGraph(repositoryId: string): Promise<RepoGraphInput | undefined> {
  const [graph] = await db.select().from(repositoryCodegraphs).where(eq(repositoryCodegraphs.repositoryId, repositoryId)).limit(1);
  if (!graph) return undefined;
  const rows = await db
    .select({ path: repositoryCodeFiles.path, parsed: repositoryCodeFiles.parsed })
    .from(repositoryCodeFiles)
    .where(eq(repositoryCodeFiles.repositoryId, repositoryId));
  const strings: RepoGraphInput["strings"] = [];
  for (const row of rows) {
    const parsed = (row.parsed ?? {}) as { strings?: Array<{ value?: unknown; line?: unknown }> };
    if (!Array.isArray(parsed.strings)) continue;
    for (const entry of parsed.strings) {
      if (typeof entry?.value !== "string") continue;
      strings.push({ path: row.path, value: entry.value, line: typeof entry.line === "number" ? entry.line : 1 });
      if (strings.length >= 40_000) break;
    }
    if (strings.length >= 40_000) break;
  }
  return {
    files: (graph.files ?? []).map((file) => ({ path: file.path, kind: file.kind })),
    connections: graph.connections ?? [],
    symbols: graph.symbols ?? [],
    symbolEdges: graph.symbolEdges ?? [],
    strings,
    knowledge: graph.knowledge ?? [],
  };
}

async function processRun(job: QueuedJob): Promise<void> {
  const { runId, input } = job;
  const claimed = await claimRun(runId);
  if (!claimed) {
    logger.warn(`[${runId.slice(0, 8)}] run was already claimed by another worker; skipping`);
    return;
  }
  let heartbeatFailures = 0;
  const heart = setInterval(() => {
    void heartbeat(runId).then((ok) => {
      if (ok) {
        heartbeatFailures = 0;
        return;
      }
      heartbeatFailures += 1;
      if (heartbeatFailures >= MAX_HEARTBEAT_FAILURES) {
        logger.error(`[${runId.slice(0, 8)}] lost the run lease after ${heartbeatFailures} failed heartbeats; completion is fenced`);
        clearInterval(heart);
      }
    });
  }, HEARTBEAT_MS);
  heart.unref?.();
  let checkRunContext: { installationId: string | number; fullName: string; checkRunId: number } | undefined;

  try {
    const repository = await storage.getRepositoryById(input.repositoryId);
    if (!repository) {
      await failRun(runId, "repository not found");
      return;
    }
    if (!repository.installationId) {
      await failRun(runId, "repository is not linked to a GitHub installation");
      return;
    }
    if (repository.reviewEnabled === false) {
      await failRun(runId, "reviews are disabled for this repository");
      return;
    }

    const pr = await githubApi.getPullRequest(repository.installationId, repository.fullName, input.pullRequestNumber);
    if (!pr.headSha) {
      await failRun(runId, "pull request has no head SHA");
      return;
    }
    const headSha = pr.headSha;
    const files = await githubApi.listPullRequestFiles(repository.installationId, repository.fullName, input.pullRequestNumber);
    const changedFiles: ReviewRequest["files"] = [];
    let truncatedFiles = 0;
    for (const file of files) {
      let content: string | undefined;
      if (file.status !== "removed" && (file.patch || file.changes > 0)) {
        if (file.additions + file.deletions > 0 || file.status === "added") {
          content = (await githubApi.getFileContent(repository.installationId, repository.fullName, file.filename, headSha)) ?? undefined;
          if (content && content.length > MAX_FILE_BYTES) {
            content = content.slice(0, MAX_FILE_BYTES);
            truncatedFiles += 1;
          }
        }
      }
      changedFiles.push({
        path: file.filename,
        status: file.status as ReviewRequest["files"][number]["status"],
        patch: file.patch,
        content,
        additions: file.additions,
        deletions: file.deletions,
      });
    }

    const installationToken = await getInstallationToken(repository.installationId);
    const checkRunId = await startReviewCheckRun({
      installationId: repository.installationId,
      fullName: repository.fullName,
      headSha,
      runId,
    });
    if (checkRunId !== undefined) {
      checkRunContext = { installationId: repository.installationId, fullName: repository.fullName, checkRunId };
    }

    const repositorySettings = (repository.settings ?? {}) as Record<string, unknown>;
    const models =
      input.models ??
      (repositorySettings.models as Partial<Record<ModelRole, string>> | undefined) ??
      resolveModelIds();
    const reasoning: Record<ModelRole, ReasoningEffort> = {
      ...resolveReasoning(),
      ...((repositorySettings.reasoning as Partial<Record<ModelRole, ReasoningEffort>> | undefined) ?? {}),
      ...(input.reasoning ?? {}),
    };
    const instructions = input.instructions ?? (typeof repositorySettings.instructions === "string" ? repositorySettings.instructions : undefined);
    const learnings = Array.isArray(repositorySettings.learnings)
      ? repositorySettings.learnings.filter((item): item is string => typeof item === "string")
      : [];
    const autoCommitFixes = repositorySettings.autoCommitFixes === true;
    const autoCommitMaxFindings =
      typeof repositorySettings.autoCommitMaxFindings === "number" && repositorySettings.autoCommitMaxFindings > 0
        ? Math.min(10, Math.floor(repositorySettings.autoCommitMaxFindings))
        : undefined;

    const graph = await loadRepoGraph(repository.id).catch((error) => {
      logger.warn(`[${runId.slice(0, 8)}] codegraph unavailable`, { error: error instanceof Error ? error.message : String(error) });
      return undefined;
    });

    // Small anchor files let the engine detect runnable surfaces without a sandbox.
    const anchors: Record<string, string> = {};
    for (const path of ["package.json", ".env.example"]) {
      const content = await githubApi.getFileContent(repository.installationId, repository.fullName, path, headSha).catch(() => undefined);
      if (content && content.length <= 200_000) anchors[path] = content;
    }

    const engineConfig = resolveEngineConfig();
    const sandboxOptions = {
      template: engineConfig.sandbox.template,
      apiKey: engineConfig.sandbox.apiKey,
      timeoutMs: engineConfig.sandbox.timeoutMs,
      repoDir: engineConfig.sandbox.repoDir,
    };
    const engine = createEngine({
      config: {
        models: { investigator: models.investigator, engineer: models.engineer, reviewer: models.reviewer, reasoning },
        sandbox: engineConfig.sandbox,
        budgets: { globalMs: Number(process.env.CORTADO_GLOBAL_TIMEOUT_MS ?? 1_800_000) },
      },
      sandboxFactory: async () => E2BSandboxInstance.create(sandboxOptions),
      verificationSandboxFactory: async () => E2BSandboxInstance.create(sandboxOptions),
      logger,
    });

    const request: ReviewRequest = {
      runId,
      repo: {
        fullName: repository.fullName,
        defaultBranch: repository.defaultBranch,
        installationId: Number(repository.installationId),
        cloneUrl: repository.cloneUrl ?? `https://github.com/${repository.fullName}.git`,
        token: installationToken,
      },
      pr: {
        number: input.pullRequestNumber,
        title: pr.title ?? `Pull request #${input.pullRequestNumber}`,
        body: pr.body ?? "",
        author: pr.author ?? undefined,
        baseSha: pr.baseSha ?? "",
        headSha,
        baseBranch: pr.baseRef ?? "",
        headBranch: pr.headRef ?? "",
        url: pr.url ?? undefined,
      },
      files: changedFiles,
      rules: [],
      learnings,
      settings: { models, reasoning, instructions, runtime: repositorySettings.runtime !== false },
      graph,
      anchors,
      repoFiles: (graph?.files ?? []).map((file) => file.path),
    };

    const result = await engine.run(request);
    if (truncatedFiles > 0) {
      result.degraded = true;
      const note = `${truncatedFiles} file(s) truncated to fit the review budget`;
      result.degradedReason = result.degradedReason ? `${result.degradedReason}; ${note}` : note;
      logger.warn(`[${runId.slice(0, 8)}] ${note}`);
    }
    await persistFindings(runId, repository, result);

    let autoCommit: AutoCommitResult | undefined;
    if (autoCommitFixes && result.status !== "failed" && !result.degraded && result.findings.some((finding) => finding.state === "verified_fix")) {
      try {
        autoCommit = await autoCommitVerifiedFixes({
          installationId: repository.installationId,
          fullName: repository.fullName,
          branch: request.pr.headBranch,
          headSha,
          runId,
          findings: result.findings,
          maxFindings: autoCommitMaxFindings,
        });
        if (autoCommit.committed.length > 0) logger.info(`[${runId.slice(0, 8)}] ${autoCommit.note}`);
        else logger.info(`[${runId.slice(0, 8)}] auto-commit: ${autoCommit.note}`);
      } catch (error) {
        logger.warn(`[${runId.slice(0, 8)}] auto-commit failed`, { error: error instanceof Error ? error.message : String(error) });
      }
    }

    const completion = await db
      .update(reviewRuns)
      .set({
        status: result.status === "failed" ? "error" : "done",
        error: result.error ?? null,
        summary: `${result.summary.issuesReproduced} reproduced · ${result.summary.issuesVerified} fixed and verified`,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        creditsSettled: Math.round(result.usage.costUsd * 1000 * 1000) / 1000,
        headSha,
        engineVersion: ENGINE_VERSION,
        model: result.models.engineer,
        plan: { candidates: result.candidates.length, findings: result.findings.length, verified: result.summary.issuesVerified },
        stats: {
          pullRequestNumber: input.pullRequestNumber,
          headSha,
          engineVersion: ENGINE_VERSION,
          models: result.models,
          timings: result.timings,
          events: result.events.slice(-200),
          usage: result.usage,
          summary: result.summary,
          report: result.report,
          coverage: result.candidates,
          autoCommit: autoCommit ?? null,
          degraded: result.degraded,
          degradedReason: result.degradedReason ?? null,
          checkRunId: checkRunId ?? null,
          codegraph: graph ? { files: graph.files?.length ?? 0, symbols: graph.symbols?.length ?? 0, strings: graph.strings?.length ?? 0 } : null,
        },
        finishedAt: new Date(),
        updatedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(and(eq(reviewRuns.id, runId), eq(reviewRuns.leaseOwner, PROCESS_ID)))
      .returning({ id: reviewRuns.id });
    if (completion.length === 0) {
      logger.warn(`[${runId.slice(0, 8)}] lost the run lease before completion; result was not persisted and nothing is published`);
      return;
    }

    await db
      .update(repositories)
      .set({ lastReviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(repositories.id, repository.id));

    let publishError: string | undefined;
    let publishedId: number | undefined;
    if (result.status !== "failed" && (result.findings.length > 0 || result.candidates.length > 0 || result.report)) {
      const published = await publishReview(
        {
          installationId: repository.installationId,
          fullName: repository.fullName,
          prNumber: input.pullRequestNumber,
          headSha,
          result,
          checkRunId,
        },
        logger,
      );
      if (published) {
        publishedId = published.id;
        logger.info(`[${runId.slice(0, 8)}] published review ${published.id}`);
      } else {
        publishError = "GitHub review publish failed";
        logger.warn(`[${runId.slice(0, 8)}] review was not published; the run can be re-enqueued`);
      }
    }
    await db
      .update(reviewRuns)
      .set({
        publishState: publishError ? "failed" : "published",
        publishAttempts: sql`${reviewRuns.publishAttempts} + 1`,
        publishError: publishError ?? null,
        publishedReviewId: publishedId ? String(publishedId) : null,
        updatedAt: new Date(),
      })
      .where(eq(reviewRuns.id, runId));

    await finishCheckRun({
      installationId: repository.installationId,
      fullName: repository.fullName,
      prNumber: input.pullRequestNumber,
      headSha,
      result,
      checkRunId,
      autoCommitNote: autoCommit?.note,
    });
    logger.info(
      `[${runId.slice(0, 8)}] done: ${result.summary.issuesReproduced} reproduced, ${result.summary.issuesVerified} verified, ` +
        `${(result.summary.durationMs / 1000).toFixed(1)}s, $${result.summary.costUsd.toFixed(4)}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[${runId.slice(0, 8)}] failed`, { error: message });
    if (checkRunContext) await failCheckRun({ ...checkRunContext, reason: message });
    await failRun(runId, message);
  } finally {
    clearInterval(heart);
  }
}

async function persistFindings(runId: string, repository: Repository, result: EngineResult): Promise<void> {
  const byId = new Map(result.findings.map((finding) => [finding.id, finding]));
  const rows = result.candidates.map((candidate) => {
    const finding: Finding | undefined = byId.get(candidate.candidateId);
    const verified = finding?.state === "verified_fix";
    return {
      runId,
      repositoryId: repository.id,
      workspaceId: repository.workspaceId,
      findingKey: candidate.candidateId,
      path: candidate.file ?? null,
      line: finding?.line ?? null,
      category: "finding",
      severity: candidate.severity,
      verdict: candidate.state,
      confidence: finding?.confidence ?? 0.5,
      title: candidate.claim.slice(0, 400),
      detail: finding?.repro.explanation ?? candidate.reason,
      evidence: finding?.evidence ?? [],
      models: {
        repro: finding?.repro.artifact ?? null,
        reviewer: finding?.fix?.reviewer ?? null,
      },
      fix: finding?.fix
        ? {
            status: finding.fix.state,
            verified,
            state: finding.state,
            patch: finding.fix.patch ?? null,
            reason: finding.fix.reason,
            attempts: finding.fix.attempts.length,
            verification: finding.fix.verification ?? null,
          }
        : { status: "NOT_ATTEMPTED", verified: false, state: candidate.state, attempts: 0 },
      status: verified ? "fixed" : "open",
    };
  });
  if (rows.length === 0) return;
  await db
    .insert(reviewFindings)
    .values(rows)
    .onConflictDoUpdate({
      target: [reviewFindings.runId, reviewFindings.findingKey],
      set: {
        repositoryId: sql`excluded.repository_id`,
        workspaceId: sql`excluded.workspace_id`,
        path: sql`excluded.path`,
        line: sql`excluded.line`,
        category: sql`excluded.category`,
        severity: sql`excluded.severity`,
        verdict: sql`excluded.verdict`,
        confidence: sql`excluded.confidence`,
        title: sql`excluded.title`,
        detail: sql`excluded.detail`,
        evidence: sql`excluded.evidence`,
        models: sql`excluded.models`,
        fix: sql`excluded.fix`,
        status: sql`excluded.status`,
        updatedAt: new Date(),
      },
    });
}

async function failRun(runId: string, message: string): Promise<void> {
  const updated = await db
    .update(reviewRuns)
    .set({
      status: "error",
      error: redactSecrets(message).slice(0, 2000),
      finishedAt: new Date(),
      updatedAt: new Date(),
      publishState: "failed",
      publishError: redactSecrets(message).slice(0, 2000),
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(and(eq(reviewRuns.id, runId), or(eq(reviewRuns.leaseOwner, PROCESS_ID), isNull(reviewRuns.leaseOwner))))
    .returning({ id: reviewRuns.id });
  if (updated.length === 0) logger.warn(`[${runId.slice(0, 8)}] failRun was fenced by another worker`);
}

export async function listReviewRuns(workspaceId: string | null, limit = 40) {
  const selection = {
    id: reviewRuns.id,
    workspaceId: reviewRuns.workspaceId,
    repositoryId: reviewRuns.repositoryId,
    pullRequestId: reviewRuns.pullRequestId,
    trigger: reviewRuns.trigger,
    status: reviewRuns.status,
    title: reviewRuns.title,
    summary: reviewRuns.summary,
    error: reviewRuns.error,
    pullRequestNumber: reviewRuns.pullRequestNumber,
    publishState: reviewRuns.publishState,
    publishError: reviewRuns.publishError,
    publishedReviewId: reviewRuns.publishedReviewId,
    stats: reviewRuns.stats,
    startedAt: reviewRuns.startedAt,
    finishedAt: reviewRuns.finishedAt,
    createdAt: reviewRuns.createdAt,
    updatedAt: reviewRuns.updatedAt,
  };
  const base = workspaceId
    ? db.select(selection).from(reviewRuns).where(eq(reviewRuns.workspaceId, workspaceId))
    : db.select(selection).from(reviewRuns);
  return base.orderBy(desc(reviewRuns.createdAt)).limit(Math.min(limit, 100));
}

export { publicModelSelection };
