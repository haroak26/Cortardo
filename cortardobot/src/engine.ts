import { resolveConfig, type ConfigRoot, type DeepPartial } from "./config";
import { buildCortadoGraph } from "./graph/pipeline";
import { ModelRouter } from "./models/router";
import type { ModelClient } from "./models/types";
import type { DryModelOptions } from "./models/dry";
import { createSandbox, type ExecHandler, type Sandbox } from "./sandbox";
import { createDrySimulationHandler } from "./sandbox/dry-simulation";
import { parseChangedFiles } from "./stages/change-intelligence";
import { DEFAULT_REPO_COMMANDS, type RepoCommands } from "./stages/proof";
import { systemClock, type Clock } from "./util/clock";
import { withTimeout } from "./util/async";
import { stableId } from "./util/hash";
import { createLogger, type Logger } from "./util/logger";
import { assembleResult } from "./result";
import type { CortadoResult, PullRequestInput } from "./types";

export interface EngineOptions extends Omit<DeepPartial<ConfigRoot>, "models"> {
  models?: { luna?: ModelClient; terra?: ModelClient; astra?: ModelClient };
  dryOptions?: DryModelOptions;
  sandbox?: Sandbox;
  sandboxHandler?: ExecHandler;
  commands?: RepoCommands;
  logger?: Logger;
  clock?: Clock;
  maxModelCalls?: number;
}

export class CortadoEngine {
  readonly config: ConfigRoot;
  readonly clock: Clock;
  readonly logger: Logger;
  private readonly models: ModelRouter;
  private readonly commands: RepoCommands;
  private readonly sandboxOverride?: Sandbox;
  private readonly sandboxHandler?: ExecHandler;
  private readonly compiledGraph;

  constructor(options: EngineOptions = {}) {
    const {
      models,
      dryOptions,
      sandbox,
      sandboxHandler,
      commands,
      logger,
      clock,
      maxModelCalls,
      ...configOverrides
    } = options;

    this.config = resolveConfig(configOverrides);
    this.clock = clock ?? systemClock;
    this.logger = logger ?? createLogger({ level: "warn", scope: "engine" });
    this.commands = commands ?? DEFAULT_REPO_COMMANDS;
    this.sandboxOverride = sandbox;
    this.sandboxHandler = sandboxHandler;

    this.models = new ModelRouter({
      config: this.config.models,
      mode: this.config.mode,
      luna: models?.luna,
      terra: models?.terra,
      astra: models?.astra,
      dryOptions: dryOptions ?? {},
      maxCalls: maxModelCalls,
    });

    this.compiledGraph = buildCortadoGraph({
      config: this.config,
      models: this.models,
      sandbox: this.sandboxOverride ?? createSandbox({ mode: "dry", files: {} }),
      commands: this.commands,
      logger: this.logger,
      clock: this.clock,
    });
  }

  async run(input: PullRequestInput): Promise<CortadoResult> {
    const startedAt = this.clock.now();
    const files = Array.isArray(input?.files) ? input.files : [];
    const runId = stableId("run", input?.id ?? input?.title ?? "unknown", files.map((file) => file?.path).join(","));

    let sandbox: Sandbox;
    try {
      sandbox = this.sandboxOverride ?? this.buildSandbox(input);
    } catch (error) {
      return this.failedResult(
        runId,
        input,
        startedAt,
        `sandbox setup failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const graph =
      sandbox === this.sandboxOverride
        ? this.compiledGraph
        : buildCortadoGraph({
            config: this.config,
            models: this.models,
            sandbox,
            commands: this.commands,
            logger: this.logger,
            clock: this.clock,
          });

    let cleanedByGraph = false;
    try {
      const finalState = await withTimeout(
        graph.invoke({
          input,
          runId,
          startedAt,
          dryRun: this.models.dryRun,
          status: "completed" as const,
        }),
        this.config.globalTimeoutMs,
        () => null,
      );
      if (!finalState || !finalState.result) {
        return this.failedResult(runId, input, startedAt, "pipeline timed out");
      }
      cleanedByGraph =
        (finalState.timings as Partial<Record<string, number>> | undefined)?.cleanup !== undefined ||
        finalState.result.timings.cleanup !== undefined;
      return finalState.result;
    } catch (error) {
      return this.failedResult(
        runId,
        input,
        startedAt,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      if (!cleanedByGraph) {
        try {
          await sandbox.cleanup();
        } catch {
          // cleanup failures must not mask the run result
        }
      }
    }
  }

  private buildSandbox(input: PullRequestInput): Sandbox {
    const files: Record<string, string> = {};
    for (const file of input.files ?? []) {
      if (file.content !== undefined) files[file.path] = file.content;
    }
    const handler =
      this.sandboxHandler ??
      (this.config.mode === "dry" ? createDrySimulationHandler(parseChangedFiles(input.files ?? [])) : undefined);
    return createSandbox({
      mode: this.config.mode,
      files,
      handler,
      root: this.config.sandbox.root,
      warmDependencies: this.config.sandbox.warmDependencies,
      allowNetwork: this.config.sandbox.allowNetwork,
    });
  }

  private failedResult(
    runId: string,
    input: PullRequestInput,
    startedAt: number,
    error: string,
  ): CortadoResult {
    return assembleResult({
      runId,
      input: { id: input.id, title: input.title },
      context: null,
      candidates: [],
      decisions: [],
      proofs: [],
      repairs: [],
      verifications: {},
      reviews: [],
      events: [],
      timings: {},
      usage: this.models.usage(),
      dryRun: this.models.dryRun,
      startedAt,
      endedAt: this.clock.now(),
      status: "failed",
      error,
    });
  }
}

export function createEngine(options: EngineOptions = {}): CortadoEngine {
  return new CortadoEngine(options);
}

export async function reviewPullRequest(
  input: PullRequestInput,
  options: EngineOptions = {},
): Promise<CortadoResult> {
  const engine = new CortadoEngine(options);
  return engine.run(input);
}
