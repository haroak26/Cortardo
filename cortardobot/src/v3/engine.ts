import { mergeModelSettings, resolveV3Config, type ModelsConfig, type V3Config } from "./config";
import { analyzeChanges } from "./intelligence";
import { runDetectors } from "./detectors";
import { runSwarm } from "./swarm";
import { mergeCandidates } from "./merge";
import { judgeCandidates } from "./judge";
import { proveCandidates, proveOne, type ProofDeps } from "./proof";
import { repairFindings } from "./repair";
import { verifyRepairs } from "./verify";
import { finalReview } from "./astra";
import { buildFindings, formatMarkdown, summaryFrom } from "./result";
import { ModelRouter, preflightModels } from "./models";
import { MemorySandbox } from "./sandbox-memory";
import type { RepoProfile, Sandbox } from "./sandbox";
import type { CacheStatsSnapshot, Candidate, ContextPack, ModelClient, ReviewRequest, ReviewResult, StageEvent, SwarmReport } from "./types";
import { createLogger, hashContent, normalizeLearnings, stableStringify, withTimeout, type Logger } from "./util";
import { cacheKey } from "./cache/keys";
import { emptyCacheStats, type CacheStore } from "./cache/store";
import { buildContextPack, buildSwarmContext } from "./agent/context-pack";
import { ENGINE_VERSION } from "./version";

export interface EngineOptions {
  config?: Partial<{
    budgets: Partial<V3Config["budgets"]>;
    mode: "live" | "dry";
    models: Partial<ModelsConfig>;
    sandbox: Partial<V3Config["sandbox"]>;
    cache: Partial<V3Config["cache"]>;
  }>;
  models?: Partial<Record<"luna" | "terra" | "astra", ModelClient>>;
  sandboxFactory?: (request: ReviewRequest) => Promise<Sandbox>;
  cache?: CacheStore;
  logger?: Logger;
  onEvent?: (event: StageEvent) => void;
  now?: () => number;
  skipModelPreflight?: boolean;
}

const EMPTY_PROFILE: RepoProfile = {
  packageManager: "npm",
  installCommand: "npm ci",
  hasNodeModules: false,
  hasTests: false,
  scripts: {},
};

export class CortadoV3Engine {
  private readonly options: EngineOptions;

  constructor(options: EngineOptions = {}) {
    this.options = options;
  }

  async run(request: ReviewRequest): Promise<ReviewResult> {
    const now = this.options.now ?? (() => Date.now());
    const startedAt = now();
    const logger = this.options.logger ?? createLogger(process.env.CORTADO_LOG_LEVEL === "debug" ? "debug" : "info", "v3");
    const events: StageEvent[] = [];
    const timings: Record<string, number> = {};
    const emit = (stage: string, status: StageEvent["status"], detail?: string, durationMs?: number) => {
      const event: StageEvent = { stage, status, at: now(), detail, durationMs };
      events.push(event);
      this.options.onEvent?.(event);
    };

    const configOverrides = this.options.config ?? {};
    const baseConfig = resolveV3Config(configOverrides);
    const models = mergeModelSettings(baseConfig.models, request.settings);
    const config: V3Config = {
      ...baseConfig,
      models,
      budgets: { ...baseConfig.budgets, ...(request.budgets ?? {}) },
    };
    const cache = config.cache.enabled ? this.options.cache : undefined;
    let degradedReason: string | undefined;
    const markDegraded = (reason: string) => {
      if (!degradedReason) degradedReason = reason;
      logger.warn(`degraded: ${reason}`);
    };
    const cacheStats = (): CacheStatsSnapshot => cache?.stats() ?? emptyCacheStats();

    const hasAllScriptedClients = (["luna", "terra", "astra"] as const).every((role) => Boolean(this.options.models?.[role]));
    if (config.mode === "live" && !hasAllScriptedClients && !this.options.skipModelPreflight) {
      emit("model_preflight", "started");
      const preflightStarted = now();
      try {
        const preflight = await withTimeout(
          preflightModels(config.models),
          15_000,
          { checked: false, available: [], missing: [], warning: "model preflight timed out" },
        );
        timings.model_preflight = now() - preflightStarted;
        if (preflight.warning) {
          logger.warn(`model preflight: ${preflight.warning}`);
          emit("model_preflight", "completed", preflight.warning, timings.model_preflight);
        } else {
          emit("model_preflight", "completed", `${preflight.available.length} models available`, timings.model_preflight);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit("model_preflight", "failed", message, now() - preflightStarted);
        throw error;
      }
    }
    logger.info(`models: luna=${models.luna} terra=${models.terra} astra=${models.astra} (reasoning ${models.reasoning.luna}/${models.reasoning.terra}/${models.reasoning.astra})`);
    emit("models", "completed", `luna=${models.luna} terra=${models.terra} astra=${models.astra}`);

    const modelRouter = new ModelRouter({
      clients: this.options.models ?? {},
      config: models,
      maxCalls: config.budgets.maxModelCalls,
      maxCostUsd: config.budgets.maxCostUsd,
      dryRun: config.mode === "dry" && Object.keys(this.options.models ?? {}).length === 0,
    });

    const deadline = startedAt + config.budgets.globalMs;
    const remaining = () => Math.max(0, deadline - now());
    const stage = async <T>(name: string, fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
      const timeLeft = remaining();
      if (timeLeft <= 1_000) {
        markDegraded(`${name} skipped: global budget exhausted`);
        emit(name, "skipped", "global budget exhausted");
        return fallback;
      }
      emit(name, "started");
      const started = now();
      try {
        const result = await withTimeout(fn(), Math.min(timeoutMs, timeLeft), fallback);
        const duration = now() - started;
        timings[name] = duration;
        emit(name, "completed", undefined, duration);
        return result;
      } catch (error) {
        const duration = now() - started;
        timings[name] = duration;
        emit(name, "failed", error instanceof Error ? error.message : String(error), duration);
        logger.error(`${name} failed`, { error: error instanceof Error ? error.message : String(error) });
        markDegraded(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        return fallback;
      }
    };

    const readCache = async <T>(kind: string, key: string): Promise<T | undefined> => {
      if (!cache) return undefined;
      try {
        const hit = await cache.get<T>(key);
        if (!hit) {
          cache.recordMiss(kind);
          return undefined;
        }
        if (typeof hit.meta?.costUsd === "number" && hit.meta.costUsd > 0) cache.recordSaved(hit.meta.costUsd);
        return hit.value;
      } catch (error) {
        logger.warn(`cache read failed (${kind})`, { error: error instanceof Error ? error.message : String(error) });
        return undefined;
      }
    };
    const writeCache = async <T>(kind: string, key: string, value: T, meta?: Record<string, unknown>): Promise<void> => {
      if (!cache) return;
      try {
        await cache.set({ key, kind, value, ttlMs: config.cache.ttlMs, meta });
      } catch (error) {
        logger.warn(`cache write failed (${kind})`, { error: error instanceof Error ? error.message : String(error) });
      }
    };

    let sandbox: Sandbox | undefined;
    let partial: Omit<ReviewResult, "markdown"> | undefined;
    let cleanupStarted = false;

    try {
      const context = analyzeChanges(request);
      const learnings = normalizeLearnings(request.learnings);
      if (learnings.length > 0) context.learnings = learnings;
      const settingsFingerprint = hashContent(
        stableStringify({ instructions: request.settings?.instructions ?? "", learnings }),
      );
      emit("change_intelligence", "completed", `${context.files.length} changed file(s), +${context.additions}/-${context.deletions}`);
      timings.change_intelligence = 0;
      const detectors = runDetectors(context);

      const fileHashes: Record<string, string> = {};
      for (const file of request.files) {
        if (file.content !== undefined) fileHashes[file.path] = hashContent(file.content);
      }
      const repoKey = request.repo.fullName;
      const headSha = request.pr.headSha;

      let sandboxSetup: Promise<void> | undefined;
      let profile: RepoProfile = EMPTY_PROFILE;
      let baselineTypecheck: Promise<boolean | undefined> | undefined;
      let baselineTests: Promise<{ passed: boolean; timedOut: boolean; output: string } | undefined> | undefined;
      let sandboxError: string | undefined;

      if (this.options.sandboxFactory) {
        emit("sandbox_setup", "started");
        const setupStarted = now();
        try {
          sandbox = await this.options.sandboxFactory(request);
          sandboxSetup = (async () => {
            await sandbox!.prepare({ cloneUrl: request.repo.cloneUrl, token: request.repo.token, ref: `refs/pull/${request.pr.number}/head`, headBranch: request.pr.headBranch });
            await sandbox!.install();
            profile = await sandbox!.profile();
            if (profile.typecheckCommand) {
              baselineTypecheck = sandbox!
                .exec(profile.typecheckCommand, { cwd: sandbox!.root, timeoutMs: 180_000, allowFailure: true })
                .then((result) => result.exitCode === 0 && !result.timedOut)
                .catch(() => undefined);
            }
            if (profile.testCommand && config.budgets.baselineMs > 0 && context.size !== "tiny") {
              baselineTests = sandbox!
                .exec(profile.testCommand, { cwd: sandbox!.root, timeoutMs: config.budgets.baselineMs, allowFailure: true })
                .then((result) => ({
                  passed: result.exitCode === 0 && !result.timedOut,
                  timedOut: result.timedOut,
                  output: `${result.stdout}\n${result.stderr}`.trim().slice(0, 4_000),
                }))
                .catch(() => undefined);
            }
          })();
          sandboxSetup.catch((error) => {
            sandboxError = error instanceof Error ? error.message : String(error);
            logger.error("sandbox preparation failed", { error: sandboxError });
          });
        } catch (error) {
          sandboxError = error instanceof Error ? error.message : String(error);
          logger.error("sandbox creation failed", { error: sandboxError });
        }
      }

      if (sandboxSetup) {
        const setupStarted = now();
        await withTimeout(sandboxSetup.catch(() => undefined), Math.min(config.budgets.sandboxSetupMs, remaining()), undefined);
        const duration = now() - setupStarted;
        timings.sandbox_setup = duration;
        emit("sandbox_setup", sandboxError ? "failed" : "completed", sandboxError, duration);
      }

      context.hasTests = Boolean(profile.testCommand);
      context.hasTypecheck = Boolean(profile.typecheckCommand);
      context.hasBuild = Boolean(profile.buildCommand);
      context.packageManager = profile.packageManager;

      let swarmPack: ContextPack | undefined;
      if (sandbox && !sandboxError) {
        const swarmContextKey = cacheKey("swarm_context", {
          repo: repoKey,
          headSha,
          fileHashes,
          payload: { profile: [profile.testCommand ?? "", profile.typecheckCommand ?? "", profile.buildCommand ?? ""], settings: settingsFingerprint },
        });
        const cachedPack = await readCache<ContextPack>("swarm_context", swarmContextKey);
        if (cachedPack && Array.isArray(cachedPack.files) && cachedPack.hash) {
          swarmPack = cachedPack;
          emit("swarm_context", "completed", `cache hit: ${cachedPack.files.length} file(s)`);
        } else {
          const packStarted = now();
          swarmPack = await buildSwarmContext({ context, sandbox, profile, instructions: request.settings?.instructions }).catch((error) => {
            logger.warn("swarm context pack failed", { error: error instanceof Error ? error.message : String(error) });
            return undefined;
          });
          timings.swarm_context = now() - packStarted;
          if (swarmPack) {
            await writeCache("swarm_context", swarmContextKey, swarmPack);
            emit("swarm_context", "completed", `${swarmPack.files.length} file(s)`, timings.swarm_context);
          } else {
            emit("swarm_context", "failed", "context pack unavailable; swarm falls back to single-shot");
          }
        }
      }

      const swarmKey = cacheKey("swarm", {
        repo: repoKey,
        headSha,
        fileHashes,
        model: models.luna,
        payload: { detectors: detectors.map((candidate) => candidate.id), title: request.pr.title, turns: config.budgets.maxSwarmTurns, settings: settingsFingerprint },
      });
      const cachedSwarm = await readCache<Candidate[] | { candidates: Candidate[]; report?: SwarmReport }>("swarm", swarmKey);
      let lunaCandidates: Candidate[];
      let swarmReport: SwarmReport | undefined;
      if (Array.isArray(cachedSwarm)) {
        lunaCandidates = cachedSwarm;
        emit("swarm_cache", "completed", `cache hit: ${lunaCandidates.length} candidate(s)`);
      } else if (cachedSwarm && Array.isArray((cachedSwarm as { candidates?: unknown }).candidates)) {
        const cached = cachedSwarm as { candidates: Candidate[]; report?: SwarmReport };
        lunaCandidates = cached.candidates;
        swarmReport = cached.report;
        emit("swarm_cache", "completed", `cache hit: ${lunaCandidates.length} candidate(s)`);
      } else {
        const swarmUsageBefore = modelRouter.usage.costUsd;
        const swarmOutcome = await stage(
          "swarm",
          () =>
            runSwarm(context, request, detectors, modelRouter, logger, config.budgets.swarmMs, {
              sandbox: sandbox && !sandboxError ? sandbox : undefined,
              profile,
              pack: swarmPack,
              maxTurns: config.budgets.maxSwarmTurns,
              maxToolsPerTurn: config.budgets.maxSwarmToolsPerTurn,
            }),
          config.budgets.swarmMs + 30_000,
          { candidates: [] as Candidate[], report: undefined as SwarmReport | undefined },
        );
        lunaCandidates = swarmOutcome.candidates;
        swarmReport = swarmOutcome.report;
        const cacheable = swarmReport ? swarmReport.agents.every((agent) => agent.status === "completed") : false;
        if (cacheable) {
          await writeCache("swarm", swarmKey, { candidates: lunaCandidates, report: swarmReport }, {
            costUsd: Number(Math.max(0, modelRouter.usage.costUsd - swarmUsageBefore).toFixed(6)),
          });
        }
      }
      if (swarmReport) {
        for (const agent of swarmReport.agents) {
          emit(
            "swarm_agent",
            agent.status === "completed" ? "completed" : "failed",
            `${agent.id}: ${agent.hypotheses} hypothesis(es), ${agent.candidates} candidate(s), ${agent.turns} turn(s), ${agent.toolCalls} tool call(s)`,
            agent.durationMs,
          );
        }
        emit(
          "swarm_detail",
          "completed",
          `${swarmReport.mode} · ${swarmReport.agents.length} agent(s) · ${swarmReport.hypotheses} hypothesis(es) · ${swarmReport.candidates} candidate(s)`,
          swarmReport.durationMs,
        );
      }
      context.riskSignals.push(...detectors.slice(0, 3).map((candidate) => `deterministic detector: ${candidate.claim.slice(0, 120)}`));

      const candidates = mergeCandidates(detectors, lunaCandidates, config.budgets.maxCandidates);

      const judgeKey = cacheKey("judge", {
        repo: repoKey,
        headSha,
        fileHashes,
        model: models.terra,
        payload: { candidates: candidates.map((candidate) => [candidate.id, candidate.severity, candidate.evidence]), maxToProve: config.budgets.maxToProve, settings: settingsFingerprint },
      });
      const cachedJudge = await readCache<{ decisions: ReviewResult["decisions"]; source: string }>("judge", judgeKey);
      let judge;
      if (cachedJudge && Array.isArray(cachedJudge.decisions)) {
        judge = cachedJudge;
        emit("judge_cache", "completed", `cache hit: ${cachedJudge.decisions.length} decision(s)`);
      } else {
        const judgeUsageBefore = modelRouter.usage.costUsd;
        judge = await stage(
          "judge",
          () => judgeCandidates(candidates, context, modelRouter, logger, config.budgets.maxToProve),
          config.budgets.judgeMs,
          { decisions: [], source: "fallback" as const },
        );
        if (judge.decisions.length > 0) {
          await writeCache("judge", judgeKey, judge, { costUsd: Number(Math.max(0, modelRouter.usage.costUsd - judgeUsageBefore).toFixed(6)) });
        }
      }

      const proofDeps: ProofDeps = { sandbox: sandbox ?? new MemorySandbox(), profile, logger, context, now };
      const toProve = candidates.filter((candidate) => judge.decisions.some((decision) => decision.candidateId === candidate.id && decision.verdict === "PROVE"));

      const proofResults: ReviewResult["proofs"] = [];
      const proofsToRun: typeof toProve = [];
      if (!sandboxError && sandbox) {
        for (const candidate of toProve) {
          const key = cacheKey("proof", {
            repo: repoKey,
            headSha,
            fileHashes,
            payload: { candidate: [candidate.id, candidate.file, candidate.line, candidate.check ?? null, candidate.suggestedProof] },
          });
          const hit = await readCache<ReviewResult["proofs"][number]>("proof", key);
          if (hit && hit.candidateId === candidate.id && (hit.status === "confirmed" || hit.status === "disproven" || hit.status === "error")) {
            proofResults.push({ ...hit, servedFromCache: true });
          } else {
            proofsToRun.push(candidate);
          }
        }
      }
      const proofRun = sandboxError || !sandbox
        ? {
            results: toProve.map((candidate) => ({
              candidateId: candidate.id,
              status: "error" as const,
              strategy: "none" as const,
              attempts: [],
              reproduction: `sandbox unavailable: ${sandboxError ?? "no sandbox configured"}`,
              explanation: `sandbox unavailable: ${sandboxError ?? "no sandbox configured"}`,
              durationMs: 0,
            })),
            appLog: `sandbox unavailable: ${sandboxError ?? "no sandbox configured"}`,
          }
        : proofsToRun.length > 0
          ? await stage("proof", () => proveCandidates(proofsToRun, context, proofDeps), config.budgets.proofMs, { results: [], appLog: "" })
          : { results: [], appLog: "" };
      if (proofRun.appLog) emit("proof_detail", "completed", proofRun.appLog.slice(0, 400));
      if (sandbox && !sandboxError) {
        for (const result of proofRun.results) {
          proofResults.push(result);
          if (result.status === "confirmed" || result.status === "disproven") {
            const candidate = candidates.find((entry) => entry.id === result.candidateId);
            const key = cacheKey("proof", {
              repo: repoKey,
              headSha,
              fileHashes,
              payload: { candidate: candidate ? [candidate.id, candidate.file, candidate.line, candidate.check ?? null, candidate.suggestedProof] : result.candidateId },
            });
            await writeCache("proof", key, result);
          }
        }
      }
      const proofs = proofResults;
      if (proofs.some((proof) => proof.servedFromCache)) emit("proof_cache", "completed", `${proofs.filter((proof) => proof.servedFromCache).length} proof(s) from cache`);

      const confirmed = proofs.filter((proof) => proof.status === "confirmed");

      const contextPackCache = new Map<string, ContextPack>();
      const contextPackFor = async (candidate: Candidate, proof: ReviewResult["proofs"][number]): Promise<ContextPack> => {
        const existing = contextPackCache.get(candidate.id);
        if (existing) return existing;
        const fileHash = candidate.file && request.files.find((file) => file.path === candidate.file)?.content !== undefined
          ? hashContent(request.files.find((file) => file.path === candidate.file)!.content!)
          : candidate.file
            ? hashContent(await proofDeps.sandbox.read(candidate.file!).catch(() => candidate.file!))
            : "";
        const key = cacheKey("context_pack", {
          repo: repoKey,
          headSha,
          fileHashes: candidate.file ? { [candidate.file]: fileHash } : {},
          payload: { candidateId: candidate.id, pack: ENGINE_VERSION, settings: settingsFingerprint },
        });
        const hit = await readCache<ContextPack>("context_pack", key);
        if (hit && Array.isArray(hit.files) && hit.hash) {
          contextPackCache.set(candidate.id, hit);
          return hit;
        }
        const pack = await buildContextPack({
          candidate,
          context,
          sandbox: proofDeps.sandbox,
          profile,
          proof,
          instructions: request.settings?.instructions,
        });
        contextPackCache.set(candidate.id, pack);
        await writeCache("context_pack", key, pack);
        return pack;
      };

      const repairs = await stage(
        "repair",
        () =>
          repairFindings(confirmed, candidates, context, {
            sandbox: proofDeps.sandbox,
            models: modelRouter,
            profile,
            logger,
            maxAttempts: config.budgets.maxAgentAttempts,
            maxRepairs: config.budgets.maxRepairs,
            maxTurns: config.budgets.maxAgentTurns,
            maxToolsPerTurn: config.budgets.maxToolCallsPerTurn,
            proveCandidate: (candidate) => proveOne(candidate, proofDeps),
            contextPackFor,
            cache,
            cacheTtlMs: config.cache.ttlMs,
            repo: repoKey,
            headSha,
            modelId: models.terra,
            instructions: request.settings?.instructions,
            costNow: () => modelRouter.usage.costUsd,
            now,
          }),
        config.budgets.repairMs,
        [],
      );

      const baselineTypecheckPassed = baselineTypecheck ? await withTimeout(baselineTypecheck, Math.min(200_000, remaining()), undefined) : undefined;
      const baselineTestResult = baselineTests
        ? await withTimeout(baselineTests, Math.min(config.budgets.baselineMs + 30_000, remaining()), undefined)
        : undefined;
      const verifications = await stage(
        "verify",
        () =>
          verifyRepairs(repairs, candidates, context, {
            sandbox: proofDeps.sandbox,
            profile,
            proveOne: (candidate) => proveOne(candidate, proofDeps),
            proveMany: async (list) => (await proveCandidates(list, context, proofDeps)).results,
            baselineTypecheckPassed,
            baselineTests: baselineTestResult,
            logger,
            now,
          }),
        config.budgets.verifyMs,
        {},
      );

      const findings = buildFindings(confirmed, candidates, repairs, verifications, []);
      const reviewKey = cacheKey("final_review", {
        repo: repoKey,
        headSha,
        fileHashes,
        model: models.astra,
        payload: {
          findings: findings.map((finding) => [
            finding.candidate.id,
            finding.repair?.exit ?? "none",
            finding.verification?.passed ?? false,
            finding.repair?.finalPatch ? hashContent(finding.repair.finalPatch) : "",
          ]),
          settings: settingsFingerprint,
        },
      });
      const cachedReviews = await readCache<ReviewResult["reviews"]>("final_review", reviewKey);
      let reviews: ReviewResult["reviews"];
      if (Array.isArray(cachedReviews) && cachedReviews.length === findings.length) {
        reviews = cachedReviews;
        emit("final_review_cache", "completed", `cache hit: ${reviews.length} review(s)`);
      } else {
        const astraUsageBefore = modelRouter.usage.costUsd;
        reviews = await stage(
          "final_review",
          () =>
            finalReview(
              findings.map((finding) => ({ candidate: finding.candidate, proof: finding.proof, repair: finding.repair, verification: finding.verification })),
              modelRouter,
              logger,
              learnings,
            ),
          config.budgets.astraMs,
          [],
        );
        if (reviews.length > 0) {
          await writeCache("final_review", reviewKey, reviews, { costUsd: Number(Math.max(0, modelRouter.usage.costUsd - astraUsageBefore).toFixed(6)) });
        }
      }
      const findingsWithReviews = buildFindings(confirmed, candidates, repairs, verifications, reviews);

      const endedAt = now();
      const finalCache = cacheStats();
      const summary = summaryFrom(candidates, judge.decisions, proofs, repairs, findingsWithReviews, startedAt, endedAt, modelRouter.usage, finalCache);
      partial = {
        runId: request.runId,
        status: "completed",
        pr: { id: request.runId, title: request.pr.title, classification: context.classification, size: context.size },
        context,
        candidates,
        decisions: judge.decisions,
        proofs,
        repairs,
        verifications,
        findings: findingsWithReviews,
        reviews,
        swarm: swarmReport,
        events,
        timings,
        usage: modelRouter.usage,
        models: { ...models, reasoning: models.reasoning },
        cache: finalCache,
        degraded: Boolean(degradedReason),
        degradedReason,
        summary,
      };
    } catch (error) {
      const endedAt = now();
      const finalCache = cacheStats();
      const message = error instanceof Error ? error.message : String(error);
      logger.error("engine run failed", { error: message });
      partial = {
        runId: request.runId,
        status: "failed",
        error: message,
        pr: { id: request.runId, title: request.pr.title, classification: [], size: "normal" },
        context: null,
        candidates: [],
        decisions: [],
        proofs: [],
        repairs: [],
        verifications: {},
        findings: [],
        reviews: [],
        events,
        timings,
        usage: modelRouter.usage,
        models: { ...models, reasoning: models.reasoning },
        cache: finalCache,
        degraded: true,
        degradedReason: message,
        summary: {
          issuesFound: 0,
          issuesConfirmed: 0,
          issuesFixed: 0,
          issuesVerified: 0,
          staticOnly: 0,
          discarded: 0,
          durationMs: endedAt - startedAt,
          modelCalls: modelRouter.usage.calls,
          costUsd: modelRouter.usage.costUsd,
          cacheHits: finalCache.hits,
          cacheMisses: finalCache.misses,
          creditsSavedUsd: finalCache.creditsSavedUsd,
          maxAttempts: 0,
        },
      };
    } finally {
      if (sandbox && !cleanupStarted) {
        cleanupStarted = true;
        emit("cleanup", "started");
        await sandbox.cleanup().catch(() => undefined);
        emit("cleanup", "completed");
      }
    }

    const result = partial!;
    return { ...result, markdown: formatMarkdown(result) };
  }
}

export function createV3Engine(options: EngineOptions = {}): CortadoV3Engine {
  return new CortadoV3Engine(options);
}
