import { resolveV3Config, type V3Config } from "./config";
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
import { ModelRouter } from "./models";
import { MemorySandbox } from "./sandbox-memory";
import type { RepoProfile, Sandbox } from "./sandbox";
import type { ModelClient, ReviewRequest, ReviewResult, StageEvent } from "./types";
import { createLogger, withTimeout, type Logger } from "./util";

export interface EngineOptions {
  config?: Partial<{ budgets: Partial<V3Config["budgets"]>; mode: "live" | "dry"; models: Partial<V3Config["models"]>; sandbox: Partial<V3Config["sandbox"]> }>;
  models?: Partial<Record<"luna" | "terra" | "astra", ModelClient>>;
  sandboxFactory?: (request: ReviewRequest) => Promise<Sandbox>;
  logger?: Logger;
  onEvent?: (event: StageEvent) => void;
  now?: () => number;
}

const EMPTY_PROFILE: RepoProfile = {
  packageManager: "npm",
  installCommand: "npm ci",
  hasNodeModules: false,
  hasTests: false,
  scripts: {},
};

export class CortadoV3Engine {
  private readonly config: V3Config;
  private readonly options: EngineOptions;

  constructor(options: EngineOptions = {}) {
    this.config = resolveV3Config(options.config);
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
    const stage = async <T>(name: string, fn: () => Promise<T>, timeoutMs: number, fallback: T): Promise<T> => {
      emit(name, "started");
      const started = now();
      try {
        const result = await withTimeout(fn(), timeoutMs, fallback);
        const duration = now() - started;
        timings[name] = duration;
        emit(name, "completed", undefined, duration);
        return result;
      } catch (error) {
        const duration = now() - started;
        timings[name] = duration;
        emit(name, "failed", error instanceof Error ? error.message : String(error), duration);
        logger.error(`${name} failed`, { error: error instanceof Error ? error.message : String(error) });
        return fallback;
      }
    };

    const models = new ModelRouter({
      clients: this.options.models ?? {},
      config: this.config.models,
      maxCalls: this.config.budgets.maxModelCalls,
      dryRun: this.config.mode === "dry" && Object.keys(this.options.models ?? {}).length === 0,
    });

    let sandbox: Sandbox | undefined;
    const context = analyzeChanges(request);
    emit("change_intelligence", "completed", `${context.files.length} changed file(s), +${context.additions}/-${context.deletions}`);
    timings.change_intelligence = 0;
    const detectors = runDetectors(context);

    let sandboxSetup: Promise<void> | undefined;
    let profile: RepoProfile = EMPTY_PROFILE;
    let baselineTypecheck: Promise<boolean | undefined> | undefined;
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

    const lunaCandidates = await stage(
      "swarm",
      () => runSwarm(context, request, detectors, models, logger, this.config.budgets.swarmMs),
      this.config.budgets.swarmMs + 15_000,
      [],
    );
    context.riskSignals.push(...detectors.slice(0, 3).map((candidate) => `deterministic detector: ${candidate.claim.slice(0, 120)}`));

    const candidates = mergeCandidates(detectors, lunaCandidates, this.config.budgets.maxCandidates);
    const judge = await stage(
      "judge",
      () => judgeCandidates(candidates, context, models, logger, this.config.budgets.maxToProve),
      this.config.budgets.judgeMs,
      { decisions: [], source: "fallback" as const },
    );

    if (sandboxSetup) {
      const setupStarted = now();
      await withTimeout(sandboxSetup.catch(() => undefined), this.config.budgets.sandboxSetupMs, undefined);
      const duration = now() - setupStarted;
      timings.sandbox_setup = duration;
      emit("sandbox_setup", sandboxError ? "failed" : "completed", sandboxError, duration);
    }

    context.hasTests = Boolean(profile.testCommand);
    context.hasTypecheck = Boolean(profile.typecheckCommand);
    context.hasBuild = Boolean(profile.buildCommand);
    context.packageManager = profile.packageManager;

    const proofDeps: ProofDeps = { sandbox: sandbox ?? new MemorySandbox(), profile, logger, now };
    const toProve = candidates.filter((candidate) => judge.decisions.some((decision) => decision.candidateId === candidate.id && decision.verdict === "PROVE"));
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
      : await stage(
          "proof",
          () => proveCandidates(toProve, context, proofDeps),
          this.config.budgets.proofMs,
          { results: [], appLog: "" },
        );
    const proofs = proofRun.results;
    if (proofRun.appLog) emit("proof_detail", "completed", proofRun.appLog.slice(0, 400));

    const confirmed = proofs.filter((proof) => proof.status === "confirmed");
    const repairs = await stage(
      "repair",
      () =>
        repairFindings(confirmed, candidates, context, {
          sandbox: proofDeps.sandbox,
          models,
          profile,
          logger,
          maxAttempts: this.config.budgets.maxRepairAttempts,
          maxRepairs: this.config.budgets.maxRepairs,
          proveCandidate: (candidate) => proveOne(candidate, proofDeps),
          now,
        }),
      this.config.budgets.repairMs,
      [],
    );

    const baselineTypecheckPassed = baselineTypecheck ? await withTimeout(baselineTypecheck, 200_000, undefined) : undefined;
    const verifications = await stage(
      "verify",
      () =>
        verifyRepairs(repairs, candidates, context, {
          sandbox: proofDeps.sandbox,
          profile,
          proveOne: (candidate) => proveOne(candidate, proofDeps),
          baselineTypecheckPassed,
          now,
        }),
      this.config.budgets.verifyMs,
      {},
    );

    const findings = buildFindings(confirmed, candidates, repairs, verifications, []);
    const reviews = await stage(
      "final_review",
      () =>
        finalReview(
          findings.map((finding) => ({ candidate: finding.candidate, proof: finding.proof, repair: finding.repair, verification: finding.verification })),
          models,
          logger,
        ),
      this.config.budgets.astraMs,
      [],
    );
    const findingsWithReviews = buildFindings(confirmed, candidates, repairs, verifications, reviews);

    const endedAt = now();
    const summary = summaryFrom(candidates, judge.decisions, proofs, repairs, findingsWithReviews, startedAt, endedAt, models.usage);
    const partial: Omit<ReviewResult, "markdown"> = {
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
      events,
      timings,
      usage: models.usage,
      summary,
    };

    if (sandbox) {
      emit("cleanup", "started");
      await sandbox.cleanup().catch(() => undefined);
      emit("cleanup", "completed");
    }
    return { ...partial, markdown: formatMarkdown(partial) };
  }
}

export function createV3Engine(options: EngineOptions = {}): CortadoV3Engine {
  return new CortadoV3Engine(options);
}
