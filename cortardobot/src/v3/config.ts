import type { BudgetConfig } from "./types";

export interface ModelsConfig {
  luna: string;
  terra: string;
  astra: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  maxTokensLuna: number;
  maxTokensTerra: number;
  maxTokensAstra: number;
  jsonMode: boolean;
}

export interface SandboxConfig {
  template: string;
  apiKey: string;
  timeoutMs: number;
  repoDir: string;
  cacheDir: string;
  allowNetwork: boolean;
}

export interface V3Config {
  mode: "live" | "dry";
  models: ModelsConfig;
  sandbox: SandboxConfig;
  budgets: BudgetConfig;
}

export const DEFAULT_BUDGETS: BudgetConfig = {
  globalMs: 720_000,
  sandboxSetupMs: 300_000,
  swarmMs: 150_000,
  judgeMs: 45_000,
  proofMs: 240_000,
  repairMs: 360_000,
  verifyMs: 240_000,
  astraMs: 60_000,
  maxModelCalls: 24,
  maxRepairAttempts: 3,
  maxCandidates: 12,
  maxToProve: 4,
  maxRepairs: 3,
  maxBrowserChecks: 6,
};

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function resolveV3Config(overrides: Partial<{ budgets: Partial<BudgetConfig>; mode: "live" | "dry"; models: Partial<ModelsConfig>; sandbox: Partial<SandboxConfig> }> = {}): V3Config {
  const apiKey =
    process.env.CORTADO_AI_API_KEY ??
    process.env.CORTARDO_BOT_MERGE_API_KEY ??
    process.env.MERGE_GATEWAY_API_KEY ??
    "";
  return {
    mode: overrides.mode ?? (apiKey ? "live" : "dry"),
    models: {
      luna: process.env.CORTADO_MODEL_LUNA ?? "zai/glm-5.3",
      terra: process.env.CORTADO_MODEL_TERRA ?? "anthropic/claude-sonnet-5",
      astra: process.env.CORTADO_MODEL_ASTRA ?? "anthropic/claude-opus-5",
      baseUrl: process.env.CORTADO_AI_BASE_URL ?? "https://api-gateway.merge.dev/v1/ai-sdk",
      apiKey,
      timeoutMs: envInt("CORTADO_MODEL_TIMEOUT_MS", 40_000),
      maxRetries: envInt("CORTADO_MODEL_RETRIES", 2),
      maxTokensLuna: envInt("CORTADO_MAX_TOKENS_LUNA", 3000),
      maxTokensTerra: envInt("CORTADO_MAX_TOKENS_TERRA", 5000),
      maxTokensAstra: envInt("CORTADO_MAX_TOKENS_ASTRA", 3000),
      jsonMode: process.env.CORTADO_JSON_MODE !== "0",
      ...overrides.models,
    },
    sandbox: {
      template: process.env.CORTADO_E2B_TEMPLATE ?? "cortardo-review-v1",
      apiKey: process.env.E2B_API_KEY ?? "",
      timeoutMs: envInt("CORTADO_SANDBOX_TIMEOUT_MS", 900_000),
      repoDir: process.env.CORTADO_SANDBOX_REPO_DIR ?? "/home/user/repo",
      cacheDir: process.env.CORTADO_SANDBOX_CACHE_DIR ?? "/home/user/cortado-cache",
      allowNetwork: process.env.CORTADO_SANDBOX_NETWORK !== "0",
      ...overrides.sandbox,
    },
    budgets: { ...DEFAULT_BUDGETS, ...overrides.budgets },
  };
}

export function mergeBudget(base: BudgetConfig, override?: Partial<BudgetConfig>): BudgetConfig {
  return override ? { ...base, ...override } : base;
}
