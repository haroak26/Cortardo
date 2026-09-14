import type { ModelConfig } from "../config";

export type ModelRole = "luna" | "terra" | "astra";

export type ModelTaskKind =
  | "swarm_agent"
  | "judge"
  | "repair_plan"
  | "repair_patch"
  | "repair_diagnosis"
  | "final_review";

export interface ModelTask {
  role: ModelRole;
  kind: ModelTaskKind;
  system: string;
  user: string;
  expectJson: boolean;
  context: Record<string, unknown>;
  timeoutMs?: number;
  maxTokens?: number;
  label?: string;
}

export interface ModelResponse {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  costUsd?: number;
  cached?: boolean;
}

export interface ModelClient {
  readonly id: string;
  readonly dryRun: boolean;
  complete(task: ModelTask): Promise<ModelResponse>;
}

export interface ModelRouterLike {
  readonly dryRun: boolean;
  complete(task: ModelTask): Promise<ModelResponse>;
  usage(): UsageLike;
}

export interface UsageLike {
  calls: number;
  callsByRole: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  credits: number;
  costUsd?: number;
  modelMs: number;
}

export interface UsageTrackerOptions {
  models: ModelConfig;
  maxCalls?: number;
}

export class ModelCallLimitError extends Error {
  constructor(limit: number) {
    super(`model call limit reached (${limit})`);
    this.name = "ModelCallLimitError";
  }
}
