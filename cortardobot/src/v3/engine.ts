import { clampBudgets, mergeModelSettings, publicModelSelection, resolveV3Config, type ModelsConfig, type V3Config } from "./config";
import { analyzeChanges } from "./intelligence";
import { runDetectors } from "./detectors";
import { runSwarm } from "./swarm";
import { mergeCandidates } from "./merge";
import { judgeCandidates } from "./judge";
import { proveCandidates, proveOne, type ProofDeps } from "./proof";
import { buildLoopCoverage, proveCandidatesWithProver } from "./prover";
import { repairFindings } from "./repair";
import { verifyRepairs, type BaselineStatus, type BaselineTestResult } from "./verify";
import { fallbackReport, fallbackReviews, finalReview } from "./astra";
import { buildFindings, formatMarkdown, summaryFrom } from "./result";
import { ModelRouter, preflightModels } from "./models";
import { MemorySandbox } from "./sandbox-memory";
import type { RepoProfile, Sandbox } from "./sandbox";
import type {
  CacheStatsSnapshot,
  Candidate,
  ContextPack,
  LoopCandidateCoverage,
  ModelClient,
  ModelRole,
  ReviewRequest,
  ReviewResult,
  StageEvent,
  SwarmReport,
} from "./types";
import { createLogger, hashContent, normalizeLearnings, stableStringify, withTimeout, type Logger } from "./util";
import { cacheKey } from "./cache/keys";
import { emptyCacheStats, type CacheStore } from "./cache/store";
import { buildContextPack, buildSwarmContext } from "./agent/context-pack";
import { ENGINE_VERSION } from "./version";
import { validateReviewRequest } from "./validate";
import { DEFAULT_MODELS, DEFAULT_REASONING } from "../../../shared/models.ts";

export interface EngineOptions {
  config?: Partial<{
    budgets: Partial<V3Config["budgets"]>;
    mode: "live" | "dry";
    models: Partial<ModelsConfig>;
    sandbox: Partial<V3Config["sandbox"]>;
    cache: Partial<V3Config["cache"]>;
  }>;
  models?: Partial<Record<ModelRole, ModelClient>>;
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
    const validation = validateReviewRequest(request);
    if (!validation.ok) return invalidRequestResult(request, validation.error);
    request = validation.value;

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
      budgets: clampBudgets({ ...baseConfig.budgets, ...(request.budgets ?? {}) }),
    };
    const cache = config.cache.enabled ? this.options.cache : undefined;
    let degradedReason: string | undefined;
    const markDegraded = (reason: string) => {
      if (!degradedReason) degradedReason = reason;
      logger.warn(`degraded: ${reason}`);
    };
    const cacheStats = (): CacheStatsSnapshot => cache?.stats() ?? emptyCacheStats();

    const hasAllScriptedClients = (["luna", "terra", "codegen", "astra"] as const).every((role) => Boolean(this.options.models?.[role]));
    if (config.mode === "live" && !hasAllScriptedClients && !this.options.skipModelPreflight) {
      emit("model_preflight", "started");
      const preflightStarted = now();
      try {
        const { value: preflight } = await withTimeout(
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
    logger.info(`models: luna=${models.luna} terra=${models.terra} codegen=${models.codegen} astra=${models.astra} (reasoning ${models.reasoning.luna}/${models.reasoning.terra}/${models.reasoning.codegen}/${models.reasoning.astra})`);
    emit("models", "completed", `luna=${models.luna} terra=${models.terra} codegen=${models.codegen} astra=${models.astra}`);

    const modelRouter = new ModelRouter({
      clients: this.options.models ?? {},
      config: models,
      maxCalls: config.budgets.maxModelCalls,
      maxCostUsd: config.budgets.maxCostUsd,
      dryRun: config.mode === "dry" && Object.keys(this.options.models ?? {}).length === 0,
    });

    const deadline = startedAt + config.budgets.globalMs;
    const remaining = () => Math.max(0, deadline - now());
    const stage = async <T>(name: string, fn: (signal: AbortSignal) => Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
      const timeLeft = remaining();
      if (timeLeft <= 1_000) {
        markDegraded(`${name} skipped: global budget exhausted`);
        emit(name, "skipped", "global budget exhausted");
        return fallback;
      }
      emit(name, "started");
      const started = now();
      const controller = new AbortController();
      const budgetMs = Math.min(timeoutMs, timeLeft);
      try {
        const { value, timedOut } = await withTimeout(
          fn(controller.signal),
          budgetMs,
          fallback,
          (error) => logger.warn(`${name} rejected after its budget was exhausted`, { error: error instanceof Error ? error.message : String(error) }),
        );
        const duration = now() - started;
        timings[name] = duration;
        if (timedOut) {
          controller.abort();
          const message = `${name} exceeded its ${Math.round(budgetMs / 1000)}s budget`;
          emit(name, "timed_out", message, duration);
          logger.warn(message);
          markDegraded(message);
          return value;
        }
        emit(name, "completed", undefined, duration);
        return value;
      } catch (error) {
        controller.abort();
        const duration = now() - started;
        timings[name] = duration;
        emit(name, "failed", error instanceof Error ? error.message : String(error), duration);
        logger.error(`${name} failed`, { error: error instanceof Error ? error.message : String(error) });
        markDegraded(`${name} failed: ${error instanceof Error ? error.message : String(error)}`);
        return fallback;
      }
    };

    const cacheValidators: Record<string, (value: unknown) => boolean> = {
      context_pack: (value) => Boolean(value && typeof value === "object" && Array.isArray((value as ContextPack).files) && typeof (value as ContextPack).hash === "string"),
      swarm_context: (value) => Boolean(value && typeof value === "object" && Array.isArray((value as ContextPack).files) && typeof (value as ContextPack).hash === "string"),
      swarm: (value) =>
        Array.isArray(value) ||
        Boolean(value && typeof value === "object" && Array.isArray((value as { candidates?: unknown }).candidates)),
      judge: (value) => Boolean(value && typeof value === "object" && Array.isArray((value as { decisions?: unknown }).decisions)),
      proof: (value) =>
        Boolean(value && typeof value === "object" && typeof (value as { status?: unknown }).status === "string" && typeof (value as { candidateId?: unknown }).candidateId === "string"),
      final_review: (value) =>
        Boolean(
          value &&
            typeof value === "object" &&
            Array.isArray((value as { reviews?: unknown }).reviews) &&
            (value as { report?: { walkthrough?: unknown } }).report &&
            Array.isArray((value as { report: { walkthrough?: unknown } }).report.walkthrough),
        ),
      repair: (value) =>
        Boolean(value && typeof value === "object" && typeof (value as { exit?: unknown }).exit === "string" && Array.isArray((value as { finalEdits?: unknown }).finalEdits)),
    };
    const readCache = async <T>(kind: string, key: string): Promise<T | undefined> => {
      if (!cache) return undefined;
      try {
        const hit = await cache.get<T>(key);
        if (!hit) {
          cache.recordMiss(kind);
          return undefined;
        }
        const valid = cacheValidators[kind];
        if (valid && !valid(hit.value)) {
          logger.warn(`cache payload for ${kind} failed validation; treating as a miss`);
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
      let baselineTypecheck: Promise<BaselineStatus> | undefined;
      let baselineTests: Promise<BaselineTestResult> | undefined;
      let sandboxError: string | undefined;
      let sandboxCreatedAt = 0;

      if (this.options.sandboxFactory) {
        emit("sandbox_setup", "started");
        sandboxCreatedAt = now();
        try {
          sandbox = await this.options.sandboxFactory(request);
          sandboxSetup = (async () => {
            await sandbox!.prepare({ cloneUrl: request.repo.cloneUrl, token: request.repo.token, ref: `refs/pull/${request.pr.number}/head`, headBranch: request.pr.headBranch });
            await sandbox!.install();
            profile = await sandbox!.profile();
            if (profile.typecheckCommand) {
              baselineTypecheck = sandbox!
                .exec(profile.typecheckCommand, { cwd: sandbox!.root, timeoutMs: 180_000, allowFailure: true })
                .then((result): BaselineStatus => (result.timedOut ? "timeout" : result.exitCode === 0 ? "green" : "red"))
                .catch(() => "unavailable" as const);
            }
            if (profile.testCommand && config.budgets.baselineMs > 0 && context.size !== "tiny") {
              baselineTests = sandbox!
                .exec(profile.testCommand, { cwd: sandbox!.root, timeoutMs: config.budgets.baselineMs, allowFailure: true })
                .then((result): BaselineTestResult => ({
                  status: result.timedOut ? "timeout" : result.exitCode === 0 ? "green" : "red",
                  output: `${result.stdout}\n${result.stderr}`.trim().slice(0, 4_000),
                }))
                .catch(() => "unavailable" as const) as unknown as Promise<BaselineTestResult>;
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

      if (sandboxError && !sandboxSetup) {
        timings.sandbox_setup = now() - sandboxCreatedAt;
        markDegraded(`sandbox unavailable: ${sandboxError}`);
        emit("sandbox_setup", "failed", sandboxError, timings.sandbox_setup);
      }
      if (sandboxSetup) {
        const setupStarted = now();
        const setup = await withTimeout(
          sandboxSetup.catch(() => undefined),
          Math.min(config.budgets.sandboxSetupMs, remaining()),
          undefined,
        );
        const duration = now() - setupStarted;
        timings.sandbox_setup = duration;
        if (setup.timedOut && !sandboxError) {
          sandboxError = `sandbox setup exceeded its ${Math.round(config.budgets.sandboxSetupMs / 1000)}s budget`;
          markDegraded(sandboxError);
          emit("sandbox_setup", "timed_out", sandboxError, duration);
        } else {
          emit("sandbox_setup", sandboxError ? "failed" : "completed", sandboxError, duration);
          if (sandboxError) markDegraded(`sandbox unavailable: ${sandboxError}`);
        }
      }

      context.hasTests = Boolean(profile.testCommand);
      context.hasTypecheck = Boolean(profile.typecheckCommand);
      context.hasBuild = Boolean(profile.buildCommand);
      context.packageManager = profile.packageManager;
      context.repoTests = profile.testFiles ?? [];

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
          if (swarmPack && (swarmPack.missingFiles ?? []).length === 0) {
            await writeCache("swarm_context", swarmContextKey, swarmPack);
            emit("swarm_context", "completed", `${swarmPack.files.length} file(s)`, timings.swarm_context);
          } else if (swarmPack) {
            emit("swarm_context", "completed", `${swarmPack.files.length} file(s); ${swarmPack.missingFiles!.length} unreadable, not cached`, timings.swarm_context);
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
        payload: {
          detectors: detectors.map((candidate) => candidate.id),
          title: request.pr.title,
          turns: config.budgets.maxSwarmTurns,
          toolsPerTurn: config.budgets.maxSwarmToolsPerTurn,
          mode: config.swarmMode,
          reasoning: models.reasoning.luna,
          settings: settingsFingerprint,
        },
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
          (signal) =>
            runSwarm(context, request, detectors, modelRouter, logger, config.budgets.swarmMs, {
              sandbox: sandbox && !sandboxError ? sandbox : undefined,
              profile,
              pack: swarmPack,
              maxTurns: config.budgets.maxSwarmTurns,
              maxToolsPerTurn: config.budgets.maxSwarmToolsPerTurn,
              mode: config.swarmMode,
              signal,
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
          // A dead investigator reduces recall; an honest run says so instead
          // of pretending the diff was fully investigated (3.4).
          if (agent.status !== "completed") {
            markDegraded(`swarm agent ${agent.id} ${agent.status}${agent.error ? `: ${agent.error.slice(0, 160)}` : ""}`);
          }
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
        payload: {
          candidates: candidates.map((candidate) => [candidate.id, candidate.severity, candidate.evidence]),
          maxToProve: config.budgets.maxToProve,
          reasoning: models.reasoning.terra,
          settings: settingsFingerprint,
        },
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
      let proofsToRun: typeof toProve = [];
      if (!sandboxError && sandbox) {
        for (const candidate of toProve) {
          const key = cacheKey("proof", {
            repo: repoKey,
            headSha,
            fileHashes,
            payload: {
              candidate: [candidate.id, candidate.file, candidate.line, candidate.check ?? null, candidate.suggestedProof],
              artifact: candidate.artifact?.artifactHash ?? null,
              runner: [profile.testCommand ?? "", profile.testSingle ? "single" : "none", profile.typecheckCommand ?? "", profile.buildCommand ?? ""],
            },
          });
          const hit = await readCache<ReviewResult["proofs"][number]>("proof", key);
          if (hit && hit.candidateId === candidate.id && (hit.status === "confirmed" || hit.status === "disproven" || hit.status === "error")) {
            proofResults.push({ ...hit, servedFromCache: true });
          } else {
            proofsToRun.push(candidate);
          }
        }
      }

      // Prover (3.4): author an executable reproduction for every judge-approved
      // candidate that has no existing browser/test plan. The 3.3 engine used a
      // boolean gate here and silently downgraded those candidates to static
      // analysis, which disabled the autonomous loop on every logic bug.
      let proverCoverage: LoopCandidateCoverage[] = [];
      let proverProofs: ReviewResult["proofs"] = [];
      const healthySandbox = sandbox && !sandboxError ? sandbox : undefined;
      if (healthySandbox && proofsToRun.length > 0) {
        const proverOutcome = await stage(
          "prove",
          (signal) =>
            proveCandidatesWithProver(proofsToRun, {
              sandbox: healthySandbox,
              profile,
              context,
              models: modelRouter,
              logger,
              instructions: request.settings?.instructions,
              maxCandidates: config.budgets.maxProverCandidates,
              attempts: config.budgets.maxProverAttempts,
              maxTurns: config.budgets.maxProverTurns,
              maxToolsPerTurn: config.budgets.maxProverToolsPerTurn,
              escalations: config.budgets.maxProverEscalations,
              deadline: now() + Math.min(config.budgets.proverMs, remaining()),
              now,
              signal,
            }),
          config.budgets.proverMs,
          { proofs: [] as ReviewResult["proofs"], coverage: [] as LoopCandidateCoverage[] },
        );
        proverCoverage = proverOutcome.coverage;
        proverProofs = proverOutcome.proofs;
        const provedIds = new Set(proverProofs.map((proof) => proof.candidateId));
        proofsToRun = proofsToRun.filter((candidate) => !provedIds.has(candidate.id));
        emit("prover_detail", "completed", `${proverProofs.length} reproduction(s) authored, ${proverCoverage.length} unprovable`);
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
          ? await stage("proof", (signal) => proveCandidates(proofsToRun, context, { ...proofDeps, signal }), config.budgets.proofMs, { results: [], appLog: "" })
          : { results: [], appLog: "" };
      if (proofRun.appLog) emit("proof_detail", "completed", proofRun.appLog.slice(0, 400));
      {
        for (const result of [...proverProofs, ...proofRun.results]) {
          proofResults.push(result);
          if (sandbox && !sandboxError && (result.status === "confirmed" || result.status === "disproven")) {
            const candidate = candidates.find((entry) => entry.id === result.candidateId);
            const key = cacheKey("proof", {
              repo: repoKey,
              headSha,
              fileHashes,
              payload: {
                candidate: candidate ? [candidate.id, candidate.file, candidate.line, candidate.check ?? null, candidate.suggestedProof] : result.candidateId,
                artifact: candidate?.artifact?.artifactHash ?? result.artifact?.artifactHash ?? null,
                runner: [profile.testCommand ?? "", profile.testSingle ? "single" : "none"],
              },
            });
            await writeCache("proof", key, result);
          }
        }
      }
      const proofs = proofResults;
      if (proofs.some((proof) => proof.servedFromCache)) emit("proof_cache", "completed", `${proofs.filter((proof) => proof.servedFromCache).length} proof(s) from cache`);

      // Loop honesty (3.4): every judge-approved candidate has a terminal state
      // and an unprovable/errored candidate degrades the run instead of looking
      // like a clean PR.
      const loop = buildLoopCoverage(judge.decisions, candidates, proofs, proverCoverage);
      if (sandbox && !sandboxError && (loop.proofUnavailable > 0 || loop.proofErrors > 0)) {
        const first = loop.candidates.find((entry) => entry.proofState !== "PROVEN");
        markDegraded(
          `judge approved ${loop.judgeProve} candidate(s); ${loop.proven} proven, ` +
            `${loop.proofUnavailable} unprovable, ${loop.proofErrors} errored` +
            (first ? ` (${first.candidateId}: ${first.reason.slice(0, 160)})` : ""),
        );
      }
      if (loop.proofErrors > 0) emit("proof_errors", "failed", `${loop.proofErrors} proof attempt(s) errored`);

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

      // Baselines are captured on the pristine head; they must be awaited
      // before repair mutates the shared sandbox working tree.
      const baselineTypecheckOutcome = baselineTypecheck
        ? await withTimeout<BaselineStatus | undefined>(baselineTypecheck, Math.min(200_000, remaining()), undefined)
        : undefined;
      if (baselineTypecheckOutcome?.timedOut) markDegraded("baseline typecheck timed out");
      const baselineTestOutcome = baselineTests
        ? await withTimeout<BaselineTestResult | undefined>(baselineTests, Math.min(config.budgets.baselineMs + 30_000, remaining()), undefined)
        : undefined;
      if (baselineTestOutcome?.timedOut) markDegraded("baseline test run timed out");
      const baselineTypecheckStatus: BaselineStatus | undefined = baselineTypecheckOutcome
        ? baselineTypecheckOutcome.timedOut
          ? "timeout"
          : baselineTypecheckOutcome.value
        : undefined;
      const baselineTestResult: BaselineTestResult | undefined = baselineTestOutcome
        ? baselineTestOutcome.timedOut
          ? { status: "timeout", output: "" }
          : baselineTestOutcome.value
        : undefined;

      const repairs = await stage(
        "repair",
        (signal) =>
          repairFindings(confirmed, candidates, context, {
            ...proofDeps,
            signal,
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
            modelId: models.codegen,
            instructions: request.settings?.instructions,
            settingsFingerprint,
            reasoning: models.reasoning.codegen,
            costNow: () => modelRouter.usage.costUsd,
            now,
          }),
        config.budgets.repairMs,
        [],
      );

      const verifications = await stage(
        "verify",
        (signal) =>
          verifyRepairs(repairs, candidates, context, {
            signal,
            sandbox: proofDeps.sandbox,
            profile,
            proveOne: (candidate) => proveOne(candidate, proofDeps),
            proveMany: async (list) => (await proveCandidates(list, context, proofDeps)).results,
            baselineTypecheck: baselineTypecheckStatus,
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
          reasoning: models.reasoning.astra,
          reviewReport: true,
          settings: settingsFingerprint,
        },
      });
      const astraItems = findings.map((finding) => ({
        candidate: finding.candidate,
        proof: finding.proof,
        repair: finding.repair,
        verification: finding.verification,
      }));
      const cachedReview = await readCache<{ reviews: ReviewResult["reviews"]; report?: ReviewResult["reviewReport"] }>("final_review", reviewKey);
      let reviews: ReviewResult["reviews"];
      let reviewReport: ReviewResult["reviewReport"];
      if (
        cachedReview &&
        Array.isArray(cachedReview.reviews) &&
        cachedReview.reviews.length === findings.length &&
        cachedReview.report &&
        Array.isArray(cachedReview.report.walkthrough)
      ) {
        reviews = cachedReview.reviews;
        reviewReport = cachedReview.report;
        emit("final_review_cache", "completed", `cache hit: ${reviews.length} review(s)`);
      } else {
        const astraUsageBefore = modelRouter.usage.costUsd;
        const reviewInput = {
          items: astraItems,
          context,
          instructions: request.settings?.instructions,
          learnings,
          candidates,
          decisions: judge.decisions,
          loop,
        };
        const outcome = await stage(
          "final_review",
          (signal) => finalReview({ ...reviewInput, signal }, modelRouter, logger),
          config.budgets.astraMs,
          {
            reviews: fallbackReviews(astraItems),
            report: fallbackReport(reviewInput),
          },
        );
        reviews = outcome.reviews;
        reviewReport = outcome.report;
        if (reviewReport?.source === "fallback") markDegraded("final review used the deterministic fallback");
        await writeCache("final_review", reviewKey, { reviews, report: reviewReport }, { costUsd: Number(Math.max(0, modelRouter.usage.costUsd - astraUsageBefore).toFixed(6)) });
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
        reviewReport,
        loop,
        swarm: swarmReport,
        events,
        timings,
        usage: modelRouter.usage,
        models: publicModelSelection(models),
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
        reviewReport: null,
        events,
        timings,
        usage: modelRouter.usage,
        models: publicModelSelection(models),
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

/** A malformed request still returns a well-formed failed ReviewResult. */
function invalidRequestResult(request: unknown, message: string): ReviewResult {
  const candidateRunId = (request as { runId?: unknown } | null)?.runId;
  const runId = typeof candidateRunId === "string" && candidateRunId.length > 0 ? candidateRunId : "invalid-request";
  const result: Omit<ReviewResult, "markdown"> = {
    runId,
    status: "failed",
    error: `invalid review request: ${message}`,
    pr: { id: runId, title: "", classification: [], size: "normal" },
    context: null,
    candidates: [],
    decisions: [],
    proofs: [],
    repairs: [],
    verifications: {},
    findings: [],
    reviews: [],
    reviewReport: null,
    events: [],
    timings: {},
    usage: { calls: 0, byRole: {}, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, modelMs: 0 },
    models: { ...DEFAULT_MODELS, reasoning: DEFAULT_REASONING },
    cache: { hits: 0, misses: 0, writes: 0, byKind: {}, creditsSavedUsd: 0 },
    degraded: true,
    degradedReason: `invalid review request: ${message}`,
    summary: {
      issuesFound: 0,
      issuesConfirmed: 0,
      issuesFixed: 0,
      issuesVerified: 0,
      staticOnly: 0,
      discarded: 0,
      durationMs: 0,
      modelCalls: 0,
      costUsd: 0,
      cacheHits: 0,
      cacheMisses: 0,
      creditsSavedUsd: 0,
      maxAttempts: 0,
    },
  };
  return { ...result, markdown: formatMarkdown(result) };
}

export function createV3Engine(options: EngineOptions = {}): CortadoV3Engine {
  return new CortadoV3Engine(options);
}
