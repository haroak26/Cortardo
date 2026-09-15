import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../../db";
import { repositories, reviewFindings, reviewRuns, type Repository } from "@shared/schema";
import { storage } from "../../storage";
import * as githubApi from "../github/api";
import { getInstallationToken } from "../github/app";
import { createV3Engine, E2BSandboxInstance, resolveV3Config } from "../../../cortardobot/src/v3/index.ts";
import type { ReviewRequest, ReviewResult, StageEvent } from "../../../cortardobot/src/v3/types.ts";
import { createLogger } from "../../../cortardobot/src/v3/util.ts";
import { ENGINE_VERSION } from "../../../cortardobot/src/v3/version.ts";
import { isVerifiedFix, findingState } from "../../../cortardobot/src/v3/result.ts";
import { resolveModelIds, resolveReasoning, type ReasoningEffort } from "@shared/models";
import { DbCacheStore } from "./cache-store";
import { ensureReviewSchema } from "./schema";
import { finishCheckRun, publishReview, startReviewCheckRun } from "./publisher";

const logger = createLogger("info", "cortado-runner");
const PROCESS_ID = `runner-${randomUUID().slice(0, 8)}`;

export interface TriggerReviewInput {
  repositoryId: string;
  pullRequestNumber: number;
  trigger: "webhook" | "mention" | "manual";
  headSha?: string;
  instructions?: string;
  models?: Partial<Record<"luna" | "terra" | "astra", string>>;
  reasoning?: Partial<Record<"luna" | "terra" | "astra", ReasoningEffort>>;
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
const MAX_FILE_BYTES = Number(process.env.CORTADO_MAX_FILE_BYTES ?? 400_000);
const LEASE_MS = Number(process.env.CORTADO_RUN_LEASE_MS ?? 20 * 60_000);
const HEARTBEAT_MS = Number(process.env.CORTADO_RUN_HEARTBEAT_MS ?? 30_000);
const STALE_MS = Number(process.env.CORTADO_STALE_RUN_MS ?? 15 * 60_000);

const cacheStore = new DbCacheStore();
let schemaReady: Promise<void> | undefined;
let recovered = false;

function ready(): Promise<void> {
  schemaReady ??= ensureReviewSchema();
  return schemaReady;
}

async function existingRunForHead(input: TriggerReviewInput): Promise<boolean> {
  if (!input.headSha || input.trigger === "manual") return false;
  const rows = await db
    .select({ id: reviewRuns.id })
    .from(reviewRuns)
    .where(
      and(
        eq(reviewRuns.repositoryId, input.repositoryId),
        eq(reviewRuns.headSha, input.headSha),
        inArray(reviewRuns.status, ["queued", "running", "done"]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * Recover runs abandoned by a crash/restart: running runs whose lease expired
 * are marked error so the next webhook can retry them.
 */
export async function recoverStaleReviewRuns(): Promise<number> {
  try {
    await ready();
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
    if (stale.length > 0) logger.warn(`recovered ${stale.length} stale review run(s)`);
    return stale.length;
  } catch (error) {
    logger.error("stale run recovery failed", { error: error instanceof Error ? error.message : String(error) });
    return 0;
  }
}

export async function enqueueReview(input: TriggerReviewInput): Promise<string | null> {
  try {
    await ready();
    if (!recovered) {
      recovered = true;
      void recoverStaleReviewRuns();
    }
    if (await existingRunForHead(input)) {
      logger.info(`skipping duplicate review for head ${input.headSha?.slice(0, 8)}`);
      return null;
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
        engineVersion: ENGINE_VERSION,
        stats: { pullRequestNumber: input.pullRequestNumber, headSha: input.headSha ?? null, engineVersion: ENGINE_VERSION },
      })
      .returning({ id: reviewRuns.id });
    const runId = run.id;
    queue.push({ runId, input });
    pump();
    logger.info(`queued review run ${runId} for ${input.repositoryId}#${input.pullRequestNumber}`);
    return runId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/duplicate key|unique/i.test(message)) {
      logger.info(`duplicate active review for head ${input.headSha?.slice(0, 8)}`);
      return null;
    }
    logger.error("failed to enqueue review", { error: message });
    return null;
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

async function claimRun(runId: string): Promise<void> {
  await db
    .update(reviewRuns)
    .set({
      status: "running",
      startedAt: new Date(),
      updatedAt: new Date(),
      leaseOwner: PROCESS_ID,
      leaseExpiresAt: new Date(Date.now() + LEASE_MS),
      heartbeatAt: new Date(),
    })
    .where(eq(reviewRuns.id, runId));
}

async function heartbeat(runId: string): Promise<void> {
  await db
    .update(reviewRuns)
    .set({ heartbeatAt: new Date(), leaseExpiresAt: new Date(Date.now() + LEASE_MS), updatedAt: new Date() })
    .where(and(eq(reviewRuns.id, runId), eq(reviewRuns.leaseOwner, PROCESS_ID)))
    .catch(() => undefined);
}

async function processRun(job: QueuedJob): Promise<void> {
  const { runId, input } = job;
  await claimRun(runId);
  const heart = setInterval(() => void heartbeat(runId), HEARTBEAT_MS);
  heart.unref?.();

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
    const changedFiles = [];
    for (const file of files) {
      let content: string | undefined;
      if (file.status !== "removed" && (file.patch || file.changes > 0)) {
        if (file.additions + file.deletions > 0 || file.status === "added") {
          content = (await githubApi.getFileContent(repository.installationId, repository.fullName, file.filename, headSha)) ?? undefined;
          if (content && content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES);
        }
      }
      changedFiles.push({
        path: file.filename,
        status: file.status as "added" | "modified" | "removed" | "renamed",
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

    const repositorySettings = (repository.settings ?? {}) as Record<string, unknown>;
    const models =
      input.models ??
      (repositorySettings.models as Partial<Record<"luna" | "terra" | "astra", string>> | undefined) ??
      resolveModelIds();
    const reasoning =
      input.reasoning ??
      (repositorySettings.reasoning as Partial<Record<"luna" | "terra" | "astra", ReasoningEffort>> | undefined) ??
      resolveReasoning();
    const instructions = input.instructions ?? (typeof repositorySettings.instructions === "string" ? repositorySettings.instructions : undefined);

    const config = resolveV3Config({ mode: "live", models });
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
      learnings: [],
      settings: {
        autoCommitFixes: false,
        models,
        reasoning,
        instructions,
      },
    };

    const eventStats: StageEvent[] = [];
    const engine = createV3Engine({
      config: {
        mode: "live",
        models,
        budgets: { globalMs: Number(process.env.CORTADO_GLOBAL_TIMEOUT_MS ?? 900_000) },
      },
      sandboxFactory: async () =>
        E2BSandboxInstance.create({
          template: config.sandbox.template,
          apiKey: config.sandbox.apiKey,
          timeoutMs: config.sandbox.timeoutMs,
          repoDir: config.sandbox.repoDir,
        }),
      cache: cacheStore,
      logger,
      onEvent: (event) => {
        eventStats.push(event);
        if (event.status !== "started") logger.info(`[${runId.slice(0, 8)}] ${event.stage} ${event.status}${event.detail ? ` — ${event.detail.slice(0, 160)}` : ""}`);
      },
    });

    const result = await engine.run(request);
    await persistFindings(runId, repository, result);
    await db
      .update(reviewRuns)
      .set({
        status: result.status === "failed" ? "error" : "done",
        error: result.error ?? null,
        summary: `${result.summary.issuesConfirmed} confirmed · ${result.summary.issuesVerified} fixed and verified`,
        tokensIn: result.usage.tokensIn,
        tokensOut: result.usage.tokensOut,
        creditsSettled: Math.round(result.usage.costUsd * 1000 * 1000) / 1000,
        headSha,
        engineVersion: ENGINE_VERSION,
        model: result.models.terra,
        plan: { candidates: result.candidates.length, proofs: result.proofs.length, repairs: result.repairs.length },
        stats: {
          pullRequestNumber: input.pullRequestNumber,
          headSha,
          engineVersion: ENGINE_VERSION,
          models: result.models,
          timings: result.timings,
          events: eventStats.slice(-120),
          usage: result.usage,
          cache: result.cache,
          swarm: result.swarm ?? null,
          summary: result.summary,
          degraded: result.degraded ?? false,
          degradedReason: result.degradedReason ?? null,
          checkRunId: checkRunId ?? null,
        },
        finishedAt: new Date(),
        updatedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      })
      .where(eq(reviewRuns.id, runId));

    await db
      .update(repositories)
      .set({ lastReviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(repositories.id, repository.id));

    if (result.status !== "failed" && (result.findings.length > 0 || result.summary.staticOnly > 0)) {
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
        logger.info(`[${runId.slice(0, 8)}] published review ${published.id}`);
      }
    }
    await finishCheckRun({
      installationId: repository.installationId,
      fullName: repository.fullName,
      prNumber: input.pullRequestNumber,
      headSha,
      result,
      checkRunId,
    });
    logger.info(
      `[${runId.slice(0, 8)}] done: ${result.summary.issuesConfirmed} confirmed, ${result.summary.issuesVerified} verified, ` +
        `${(result.summary.durationMs / 1000).toFixed(1)}s, $${result.summary.costUsd.toFixed(4)}, ` +
        `cache ${result.summary.cacheHits}/${result.summary.cacheHits + result.summary.cacheMisses}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`[${runId.slice(0, 8)}] failed`, { error: message });
    await failRun(runId, message);
  } finally {
    clearInterval(heart);
  }
}

async function persistFindings(runId: string, repository: Repository, result: ReviewResult): Promise<void> {
  const verifiedByCandidate = new Map(result.findings.map((finding) => [finding.candidate.id, isVerifiedFix(finding)]));
  const rows = result.candidates.map((candidate) => {
    const proof = result.proofs.find((entry) => entry.candidateId === candidate.id);
    const repair = result.repairs.find((entry) => entry.candidateId === candidate.id);
    const verification = result.verifications[candidate.id];
    const review = result.reviews.find((entry) => entry.candidateId === candidate.id);
    const decision = result.decisions.find((entry) => entry.candidateId === candidate.id);
    const confirmed = proof?.status === "confirmed";
    const finding = result.findings.find((entry) => entry.candidate.id === candidate.id);
    const verified = verifiedByCandidate.get(candidate.id) ?? false;
    const state = finding ? findingState(finding) : confirmed ? "UNRESOLVED" : "UNSUPPORTED";
    const verdict = confirmed ? "confirmed" : decision?.verdict === "STATIC_ONLY" ? "static_only" : "dismissed";
    return {
      runId,
      repositoryId: repository.id,
      workspaceId: repository.workspaceId,
      findingKey: candidate.id,
      path: candidate.file ?? null,
      line: candidate.line ?? null,
      category: candidate.agentKind,
      severity: candidate.severity,
      verdict,
      confidence: candidate.confidence,
      title: candidate.claim.slice(0, 400),
      detail: proof?.explanation ?? candidate.claim,
      evidence: candidate.evidence,
      models: {
        luna: result.models.luna,
        terra: result.models.terra,
        astra: result.models.astra,
        proof: proof ?? null,
        review: review ?? null,
        decision: decision ?? null,
      },
      fix: {
        status: repair?.exit ?? "NOT_ATTEMPTED",
        verified,
        state,
        patch: repair?.finalPatch ?? null,
        reason: repair?.reason ?? null,
        attempts: repair?.attempts.length ?? 0,
        transcripts: repair?.transcript?.turns.length ?? 0,
      },
      status: verified ? "fixed" : "open",
    };
  });
  if (rows.length === 0) return;
  await db.insert(reviewFindings).values(rows);
}

async function failRun(runId: string, message: string): Promise<void> {
  await db
    .update(reviewRuns)
    .set({
      status: "error",
      error: message.slice(0, 2000),
      finishedAt: new Date(),
      updatedAt: new Date(),
      leaseOwner: null,
      leaseExpiresAt: null,
    })
    .where(eq(reviewRuns.id, runId));
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
