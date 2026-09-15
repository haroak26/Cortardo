import type { BudgetConfig } from "./types";
import type { ModelRole, ReasoningEffort } from "../../../shared/models.ts";
import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  REASONING_ENV_KEYS,
  MODEL_ENV_KEYS,
  parseReasoningEffort,
  resolveModelIds,
} from "../../../shared/models.ts";

export interface ModelsConfig {
  luna: string;
  terra: string;
  astra: string;
  reasoning: Record<ModelRole, ReasoningEffort>;
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

export interface CacheConfig {
  enabled: boolean;
  ttlMs: number;
  maxEntries: number;
}

export interface V3Config {
  mode: "live" | "dry";
  models: ModelsConfig;
  sandbox: SandboxConfig;
  cache: CacheConfig;
  budgets: BudgetConfig;
}

export const DEFAULT_BUDGETS: BudgetConfig = {
  globalMs: 720_000,
  sandboxSetupMs: 300_000,
  swarmMs: 150_000,
  judgeMs: 45_000,
  proofMs: 240_000,
  repairMs: 420_000,
  verifyMs: 240_000,
  astraMs: 60_000,
  baselineMs: 180_000,
  maxModelCalls: 40,
  maxRepairAttempts: 3,
  maxCandidates: 12,
  maxToProve: 4,
  maxRepairs: 3,
  maxBrowserChecks: 6,
  maxAgentAttempts: 2,
  maxAgentTurns: 3,
  maxToolCallsPerTurn: 4,
  maxSwarmTurns: 3,
  maxSwarmToolsPerTurn: 3,
  maxCostUsd: 1,
};

export const DEFAULT_CACHE: CacheConfig = {
  enabled: true,
  ttlMs: 7 * 24 * 60 * 60 * 1000,
  maxEntries: 5_000,
};

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envFloat(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function envIntAllowZero(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(value.trim().toLowerCase());
}

export interface V3ConfigOverrides {
  budgets?: Partial<BudgetConfig>;
  mode?: "live" | "dry";
  models?: Partial<ModelsConfig>;
  sandbox?: Partial<SandboxConfig>;
  cache?: Partial<CacheConfig>;
}

export function resolveV3Config(overrides: V3ConfigOverrides = {}): V3Config {
  const apiKey =
    process.env.CORTADO_AI_API_KEY ??
    process.env.CORTARDO_BOT_MERGE_API_KEY ??
    process.env.MERGE_GATEWAY_API_KEY ??
    "";
  const ids = resolveModelIds({
    overrides: {
      luna: overrides.models?.luna,
      terra: overrides.models?.terra,
      astra: overrides.models?.astra,
    },
  });
  const reasoning: Record<ModelRole, ReasoningEffort> = {
    luna:
      overrides.models?.reasoning?.luna ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.luna]) ??
      DEFAULT_REASONING.luna,
    terra:
      overrides.models?.reasoning?.terra ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.terra]) ??
      DEFAULT_REASONING.terra,
    astra:
      overrides.models?.reasoning?.astra ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.astra]) ??
      DEFAULT_REASONING.astra,
  };
  return {
    mode: overrides.mode ?? (apiKey ? "live" : "dry"),
    models: {
      luna: ids.luna,
      terra: ids.terra,
      astra: ids.astra,
      baseUrl: process.env.CORTADO_AI_BASE_URL ?? "https://api-gateway.merge.dev/v1/ai-sdk",
      apiKey,
      timeoutMs: envInt("CORTADO_MODEL_TIMEOUT_MS", 60_000),
      maxRetries: envInt("CORTADO_MODEL_RETRIES", 3),
      maxTokensLuna: envInt("CORTADO_MAX_TOKENS_LUNA", 4000),
      maxTokensTerra: envInt("CORTADO_MAX_TOKENS_TERRA", 6000),
      maxTokensAstra: envInt("CORTADO_MAX_TOKENS_ASTRA", 3000),
      jsonMode: process.env.CORTADO_JSON_MODE !== "0",
      ...overrides.models,
      reasoning: { ...reasoning, ...(overrides.models?.reasoning ?? {}) },
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
    cache: {
      enabled: envBool("CORTADO_CACHE_ENABLED", DEFAULT_CACHE.enabled),
      ttlMs: envInt("CORTADO_CACHE_TTL_MS", DEFAULT_CACHE.ttlMs),
      maxEntries: envInt("CORTADO_CACHE_MAX_ENTRIES", DEFAULT_CACHE.maxEntries),
      ...overrides.cache,
    },
    budgets: {
      ...DEFAULT_BUDGETS,
      maxModelCalls: envInt("CORTADO_MODEL_CALL_BUDGET", DEFAULT_BUDGETS.maxModelCalls),
      maxAgentAttempts: envInt("CORTADO_AGENT_ATTEMPTS", DEFAULT_BUDGETS.maxAgentAttempts),
      maxAgentTurns: envInt("CORTADO_AGENT_TURNS", DEFAULT_BUDGETS.maxAgentTurns),
      maxToolCallsPerTurn: envInt("CORTADO_AGENT_TOOL_CALLS", DEFAULT_BUDGETS.maxToolCallsPerTurn),
      maxSwarmTurns: envInt("CORTADO_SWARM_TURNS", DEFAULT_BUDGETS.maxSwarmTurns),
      maxSwarmToolsPerTurn: envInt("CORTADO_SWARM_TOOLS", DEFAULT_BUDGETS.maxSwarmToolsPerTurn),
      maxCostUsd: envFloat("CORTADO_MAX_COST_USD", DEFAULT_BUDGETS.maxCostUsd),
      baselineMs: envIntAllowZero("CORTADO_BASELINE_MS", DEFAULT_BUDGETS.baselineMs),
      ...overrides.budgets,
    },
  };
}

/** Merge request-level model/reasoning settings into a base config. */
export function mergeModelSettings(
  base: ModelsConfig,
  settings: ReviewRequestSettings | undefined,
): ModelsConfig {
  if (!settings) return base;
  return {
    ...base,
    ...(settings.models?.luna ? { luna: settings.models.luna } : {}),
    ...(settings.models?.terra ? { terra: settings.models.terra } : {}),
    ...(settings.models?.astra ? { astra: settings.models.astra } : {}),
    reasoning: {
      luna: settings.reasoning?.luna ?? base.reasoning.luna,
      terra: settings.reasoning?.terra ?? base.reasoning.terra,
      astra: settings.reasoning?.astra ?? base.reasoning.astra,
    },
  };
}

interface ReviewRequestSettings {
  models?: Partial<Record<ModelRole, string>>;
  reasoning?: Partial<Record<ModelRole, ReasoningEffort>>;
}

export function mergeBudget(base: BudgetConfig, override?: Partial<BudgetConfig>): BudgetConfig {
  return override ? { ...base, ...override } : base;
}

export { DEFAULT_MODELS };
