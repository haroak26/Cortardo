/**
 * CortardoBot 3.5 engine.
 *
 * plan → investigate (specialized swarm, reproduce-or-drop) → fix (3 attempts
 * with a context-refresh swarm on failure) → verify (clean replay + independent
 * reviewer) → report. Budgets are soft: they stop new work, never the run.
 */
import { publicModelSelection, resolveEngineConfig, type EngineConfigOverrides } from "./config";
import { ModelRouter, preflightModels } from "./models";
import { LazySandbox } from "./sandbox-lazy";
import { detectRuntime } from "./context/runtime";
import { runArtifact } from "./artifact";
import { planStage } from "./stages/plan";
import { investigateStage } from "./stages/investigate";
import { fixStage } from "./stages/fix";
import { verifyStage } from "./stages/verify";
import { coverageOf, reportStage } from "./stages/report";
import type {
  CandidateRecord,
  EngineResult,
  Finding,
  ReproArtifact,
  ReviewRequest,
  RunReport,
  RunSummary,
  Sandbox,
  StageEvent,
} from "./types";
import { createLogger, redactSecrets, truncate, type Logger } from "./util";
import { ENGINE_VERSION } from "./version";

export interface EngineOptions {
  config?: EngineConfigOverrides;
  /** Injectable transport (deterministic tests); built from config when absent. */
  transport?: ModelRouter;
  sandboxFactory?: (request: ReviewRequest) => Promise<Sandbox>;
  /** Optional second sandbox for the independent replay. */
  verificationSandboxFactory?: (request: ReviewRequest) => Promise<Sandbox>;
  logger?: Logger;
  now?: () => number;
}

const STATE_PRIORITY: Record<string, number> = {
  error: 6,
  deferred: 5,
  verified_fix: 4,
  fix_failed: 3,
  reproduced: 2,
  not_reproduced: 1,
};

export class Engine {
  readonly config;
  private readonly options: EngineOptions;
  private readonly logger: Logger;
  private readonly now: () => number;

  constructor(options: EngineOptions = {}) {
    this.options = options;
    this.config = resolveEngineConfig(options.config);
    this.logger = options.logger ?? createLogger("info", "cortado-engine");
    this.now = options.now ?? (() => Date.now());
  }

  async run(request: ReviewRequest): Promise<EngineResult> {
    const started = this.now();
    const events: StageEvent[] = [];
    const timings: Record<string, number> = {};
    const emit = (stage: string, status: StageEvent["status"], detail?: string, at?: number, durationMs?: number) => {
      events.push({ stage, status, detail: detail ? redactSecrets(detail) : undefined, at: at ?? this.now(), durationMs });
    };
    const stage = async <T>(name: string, run: () => Promise<T>, budgetKey: keyof typeof budgets): Promise<T> => {
      const stageStarted = this.now();
      emit(name, "started");
      const result = await run();
      const duration = this.now() - stageStarted;
      timings[name] = duration;
      emit(name, "completed", undefined, stageStarted, duration);
      return result;
    };

    const budgets = this.config.budgets;
    const deadline = started + budgets.globalMs;
    const transport =
      this.options.transport ??
      new ModelRouter({
        clients: {},
        config: this.config.models,
        maxCalls: budgets.maxModelCalls,
        maxCostUsd: budgets.maxCostUsd,
        dryRun: false,
      });
    const models = publicModelSelection(this.config.models);

    if (!this.options.transport && this.config.models.apiKey) {
      try {
        const preflight = await preflightModels(this.config.models);
        emit(
          "model_preflight",
          "completed",
          preflight.checked ? `${preflight.available.length} models available` : preflight.warning,
        );
      } catch (error) {
        throw new Error(`model preflight failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const plan = planStage(request);
    const context = plan.context;
    const runtime = detectRuntime(request, context);
    let runtimeReport: RunReport["runtime"] = runtime.enabled
      ? { status: "exercised", surfaces: runtime.surfaces }
      : { status: "skipped", surfaces: [], reason: runtime.reason };
    let sandbox: LazySandbox | undefined;
    const freshSandboxes: Sandbox[] = [];

    try {
      sandbox = this.options.sandboxFactory
        ? new LazySandbox(
            () => this.options.sandboxFactory!(request),
            async (instance) => {
              await instance.prepare({
                cloneUrl: request.repo.cloneUrl,
                token: request.repo.token,
                ref: request.pr.headSha,
                headBranch: request.pr.headBranch,
              });
              await instance.install();
            },
            this.config.sandbox.repoDir,
          )
        : undefined;

      let findings: Finding[] = [];
      const candidates: CandidateRecord[] = [];
      const activeSandbox = sandbox;
      let infraError: string | undefined;
      if (runtime.enabled && !activeSandbox) {
        runtimeReport = { status: "skipped", surfaces: [], reason: "no sandbox is configured for this run" };
      }

      if (activeSandbox) {
        const probeDir = `${activeSandbox.root}/.cortado-probes`;
        const checkout = async (ref: string): Promise<boolean> => {
          const fetch = await activeSandbox.exec(`git fetch --quiet --depth 50 origin ${ref}`, { timeoutMs: 180_000, allowFailure: true });
          if (fetch.exitCode !== 0 && !/already exists|up to date/i.test(`${fetch.stdout}${fetch.stderr}`)) {
            // A direct SHA fetch may be refused; the object is often already present.
          }
          const result = await activeSandbox.exec(`git checkout --quiet --force ${ref}`, { timeoutMs: 120_000, allowFailure: true });
          return result.exitCode === 0;
        };
        const baseCompare = runtime.enabled && request.pr.baseSha
          ? async (artifact: ReproArtifact) => {
              const head = request.pr.headSha;
              const base = request.pr.baseSha;
              if (!(await checkout(base))) {
                await checkout(head);
                return { status: "error" as const, output: "could not check out the base revision" };
              }
              try {
                const result = await runArtifact(activeSandbox, artifact, probeDir, { runs: 1, expect: "pass" });
                const output = truncate(result.outputs.join("\n---\n"), 800);
                const status = result.passed ? ("pass" as const) : ("fail" as const);
                if (!result.passed) this.logger.info(`runtime: the scenario also fails on base — ${truncate(result.reason, 160)}`);
                if (!(await checkout(head))) return { status: "error" as const, output: "the sandbox could not be restored to the head revision" };
                return { status, output };
              } catch (error) {
                await checkout(head);
                return { status: "error" as const, output: error instanceof Error ? error.message : String(error) };
              }
            }
          : undefined;
        const investigation = await stage(
          "investigate",
          () =>
            investigateStage({
              sandbox: activeSandbox,
              transport,
              context,
              logger: this.logger,
              maxAgents: budgets.investigate.maxAgents,
              maxHypotheses: budgets.investigate.maxHypotheses,
              maxTurns: budgets.investigate.maxTurns,
              maxToolsPerTurn: budgets.investigate.maxToolsPerTurn,
              deadline: Math.min(deadline, this.now() + budgets.investigateMs + (runtime.enabled ? budgets.runtimeMs : 0)),
              seeds: runtime.enabled ? runtime.seeds : undefined,
              runtime,
              baseCompare,
            }),
          "investigateMs",
        );
        findings = investigation.findings;
        candidates.push(...investigation.candidates);
        if (activeSandbox.error) infraError = `sandbox unavailable: ${activeSandbox.error}`;
        if (activeSandbox.ready) {
          context.profile = await activeSandbox.profile().catch(() => context.profile);
        }
        this.logger.info(
          `investigate: ${findings.length} reproduced, ${candidates.filter((entry) => entry.state === "not_reproduced").length} not reproduced, ` +
            `${candidates.filter((entry) => entry.state === "error").length} errored`,
        );
      } else {
        emit("investigate", "skipped", "no sandbox configured; detection-only run");
      }

      if (activeSandbox && findings.length > 0) {
        const budgetExhausted = () =>
          transport.usage.calls >= transport.maxCalls || (transport.maxCostUsd > 0 && transport.usage.costUsd >= transport.maxCostUsd);
        const fix = await stage(
          "fix",
          () =>
            fixStage(findings, {
              sandbox: activeSandbox,
              transport,
              context,
              logger: this.logger,
              attempts: budgets.fix.attempts,
              maxTurns: budgets.fix.maxTurns,
              maxToolsPerTurn: budgets.fix.maxToolsPerTurn,
              diagnosisQuestions: budgets.fix.diagnosisQuestions,
              refreshResearchers: budgets.fix.refreshResearchers,
              refreshTurns: budgets.fix.refreshTurns,
              deadline: Math.min(deadline, this.now() + budgets.fixMs),
              globalDeadline: deadline,
              budgetExhausted,
            }),
          "fixMs",
        );
        findings = fix.findings;
        candidates.push(...fix.candidates);

        const pending = findings.filter((finding) => finding.fix?.state === "pending_verify");
        if (pending.length > 0) {
          const verify = await stage(
            "verify",
            () =>
              verifyStage(findings, {
                sandbox: activeSandbox,
                freshSandbox: this.options.verificationSandboxFactory
                  ? async () => {
                      const instance = await this.options.verificationSandboxFactory!(request);
                      try {
                        await instance.prepare({
                          cloneUrl: request.repo.cloneUrl,
                          token: request.repo.token,
                          ref: request.pr.headSha,
                          headBranch: request.pr.headBranch,
                        });
                        await instance.install();
                        freshSandboxes.push(instance);
                        return instance;
                      } catch (error) {
                        this.logger.warn("fresh verification sandbox failed; replaying in the current sandbox", {
                          error: error instanceof Error ? error.message : String(error),
                        });
                        await instance.cleanup().catch(() => undefined);
                        return undefined;
                      }
                    }
                  : undefined,
                transport,
                context,
                logger: this.logger,
                maxTurns: budgets.verify.maxTurns,
                maxToolsPerTurn: budgets.verify.maxToolsPerTurn,
                deadline: Math.min(deadline, this.now() + budgets.verifyMs),
              }),
            "verifyMs",
          );
          findings = verify.findings;
          candidates.push(...verify.candidates);
        }
      }

      const report = await stage(
        "report",
        () =>
          reportStage(findings, candidates, {
            transport,
            context,
            logger: this.logger,
            deadline: Math.min(deadline, this.now() + budgets.reportMs),
            runtime: runtimeReport,
          }),
        "reportMs",
      );

      const coverage = coverageOf(findings, candidates);
      const deduped = new Map<string, CandidateRecord>();
      for (const entry of coverage) {
        const existing = deduped.get(entry.candidateId);
        if (!existing || (STATE_PRIORITY[entry.state] ?? 0) >= (STATE_PRIORITY[existing.state] ?? 0)) deduped.set(entry.candidateId, entry);
      }
      const finalCoverage = [...deduped.values()];
      const verified = findings.filter((finding) => finding.state === "verified_fix").length;
      const summary: RunSummary = {
        issuesFound: finalCoverage.length,
        issuesConfirmed: findings.length,
        issuesReproduced: findings.length,
        issuesFixed: verified,
        issuesVerified: verified,
        staticOnly: finalCoverage.filter((entry) => entry.state === "not_reproduced").length,
        deferred: finalCoverage.filter((entry) => entry.state === "deferred").length,
        errors: finalCoverage.filter((entry) => entry.state === "error").length,
        durationMs: this.now() - started,
        modelCalls: transport.usage.calls,
        costUsd: transport.usage.costUsd,
      };
      timings.total = summary.durationMs;
      emit("done", "completed", `${summary.issuesReproduced} reproduced · ${verified} verified · $${summary.costUsd.toFixed(4)}`);

      return {
        runId: request.runId,
        status: "done",
        degraded: report.degraded || Boolean(infraError),
        degradedReason: [report.degradedReason, infraError].filter(Boolean).join("; ") || undefined,
        pr: { classification: context.classification, size: context.size },
        files: context.changed,
        candidates: finalCoverage,
        findings,
        summary,
        report: report.report,
        models,
        usage: transport.usage,
        timings,
        events,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`engine run failed: ${message}`);
      emit("failed", "failed", message);
      return {
        runId: request.runId,
        status: "failed",
        error: redactSecrets(message).slice(0, 2_000),
        degraded: true,
        degradedReason: `engine failure: ${message.slice(0, 300)}`,
        pr: { classification: context.classification, size: context.size },
        files: context.changed,
        candidates: [],
        findings: [],
        summary: {
          issuesFound: 0,
          issuesConfirmed: 0,
          issuesReproduced: 0,
          issuesFixed: 0,
          issuesVerified: 0,
          staticOnly: 0,
          deferred: 0,
          errors: 1,
          durationMs: this.now() - started,
          modelCalls: transport.usage.calls,
          costUsd: transport.usage.costUsd,
        },
        report: {
          verdict: { decision: "request_changes", confidence: 1, rationale: `The engine failed before completing the review: ${message.slice(0, 300)}` },
          summary: "The run failed; no findings were produced.",
          reproduced: [],
          verified: [],
          unresolved: [],
          coverage: [],
        },
        models,
        usage: transport.usage,
        timings,
        events,
      };
    } finally {
      await sandbox?.cleanup().catch(() => undefined);
      for (const instance of freshSandboxes) await instance.cleanup().catch(() => undefined);
    }
  }
}

export function createEngine(options: EngineOptions = {}): Engine {
  return new Engine(options);
}

export { ENGINE_VERSION };
