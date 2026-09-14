import type { ModelConfig } from "../config";
import { DryModel, type DryModelOptions } from "./dry";
import type { DetectorFinding } from "../agents/detectors";
import { OpenAiCompatibleClient } from "./live";
import { UsageTracker } from "./usage";
import type { ModelClient, ModelRole, ModelRouterLike, ModelTask, UsageLike } from "./types";

export interface ModelRouterOptions {
  config: ModelConfig;
  mode: "dry" | "live";
  luna?: ModelClient;
  terra?: ModelClient;
  astra?: ModelClient;
  dryOptions?: DryModelOptions;
  maxCalls?: number;
}

export class ModelRouter implements ModelRouterLike {
  private readonly clients: Record<ModelRole, ModelClient>;
  private readonly tracker: UsageTracker;
  readonly dryRun: boolean;

  constructor(options: ModelRouterOptions) {
    const dryOptions = options.dryOptions ?? {};
    const findingCache: Map<string, DetectorFinding> = dryOptions.findingCache ?? new Map();
    this.clients = {
      luna:
        options.luna ??
        (options.mode === "dry"
          ? new DryModel({ ...dryOptions, modelName: "luna-sim", findingCache })
          : makeLive("luna", options.config)),
      terra:
        options.terra ??
        (options.mode === "dry"
          ? new DryModel({ ...dryOptions, modelName: "terra-sim", findingCache })
          : makeLive("terra", options.config)),
      astra:
        options.astra ??
        (options.mode === "dry"
          ? new DryModel({ ...dryOptions, modelName: "astra-sim", findingCache })
          : makeLive("astra", options.config)),
    };
    if (options.mode === "live" && !options.config.apiKey) {
      throw new Error("live mode requires CORTADO_AI_API_KEY (set mode: 'dry' to run without AI calls)");
    }
    this.dryRun = Object.values(this.clients).every((client) => client.dryRun);
    this.tracker = new UsageTracker({ models: options.config, maxCalls: options.maxCalls });
  }

  async complete(task: ModelTask): Promise<ReturnType<ModelClient["complete"]> extends Promise<infer R> ? R : never> {
    this.tracker.begin(task.role);
    const client = this.clients[task.role];
    const response = await client.complete(task);
    this.tracker.recordTokens(response.tokensIn, response.tokensOut, response.durationMs, response.costUsd);
    return response;
  }

  usage(): UsageLike {
    return this.tracker.snapshot();
  }
}

function makeLive(role: ModelRole, config: ModelConfig): ModelClient {
  const model = role === "luna" ? config.luna : role === "terra" ? config.terra : config.astra;
  return new OpenAiCompatibleClient({ role, model, config });
}

export function createModelRouter(options: ModelRouterOptions): ModelRouter {
  return new ModelRouter(options);
}
