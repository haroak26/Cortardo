import type { BudgetConfig, SwarmMode } from "./types";
import type { ModelRole, ModelSelection, ReasoningEffort } from "../../../shared/models.ts";
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
  /** Code generation (repair + diagnosis) — gpt-6-astra by default. */
  codegen: string;
  astra: string;
  reasoning: Record<ModelRole, ReasoningEffort>;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  maxTokensLuna: number;
  maxTokensTerra: number;
  maxTokensCodegen: number;
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
  /** Investigation mode; "auto" uses the agentic swarm when a sandbox pack exists. */
  swarmMode: SwarmMode;
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
  proverMs: 180_000,
  repairMs: 420_000,
  verifyMs: 240_000,
  astraMs: 180_000,
  baselineMs: 180_000,
  maxModelCalls: 48,
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
  maxProverCandidates: 4,
  maxProverAttempts: 2,
  maxProverTurns: 3,
  maxProverToolsPerTurn: 3,
  maxProverEscalations: 1,
  maxCostUsd: 1.5,
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

function envSwarmMode(name: string, fallback: SwarmMode): SwarmMode {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  if (value === "agentic") return "agentic";
  if (["single-shot", "single_shot", "single", "off", "0", "false"].includes(value)) return "single-shot";
  return fallback;
}

export interface V3ConfigOverrides {
  budgets?: Partial<BudgetConfig>;
  mode?: "live" | "dry";
  swarmMode?: SwarmMode;
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
      codegen: overrides.models?.codegen,
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
    codegen:
      overrides.models?.reasoning?.codegen ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.codegen]) ??
      DEFAULT_REASONING.codegen,
    astra:
      overrides.models?.reasoning?.astra ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.astra]) ??
      DEFAULT_REASONING.astra,
  };
  return {
    mode: overrides.mode ?? (apiKey ? "live" : "dry"),
    swarmMode: overrides.swarmMode ?? envSwarmMode("CORTADO_SWARM_MODE", "auto"),
    models: {
      luna: ids.luna,
      terra: ids.terra,
      codegen: ids.codegen,
      astra: ids.astra,
      baseUrl: process.env.CORTADO_AI_BASE_URL ?? "https://api-gateway.merge.dev/v1/ai-sdk",
      apiKey,
      timeoutMs: envInt("CORTADO_MODEL_TIMEOUT_MS", 60_000),
      maxRetries: envInt("CORTADO_MODEL_RETRIES", 3),
      maxTokensLuna: envInt("CORTADO_MAX_TOKENS_LUNA", 4000),
      maxTokensTerra: envInt("CORTADO_MAX_TOKENS_TERRA", 6000),
      maxTokensCodegen: envInt("CORTADO_MAX_TOKENS_CODEGEN", 8000),
      maxTokensAstra: envInt("CORTADO_MAX_TOKENS_ASTRA", 8000),
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
    budgets: clampBudgets({
      ...DEFAULT_BUDGETS,
      maxModelCalls: envInt("CORTADO_MODEL_CALL_BUDGET", DEFAULT_BUDGETS.maxModelCalls),
      maxAgentAttempts: envInt("CORTADO_AGENT_ATTEMPTS", DEFAULT_BUDGETS.maxAgentAttempts),
      maxAgentTurns: envInt("CORTADO_AGENT_TURNS", DEFAULT_BUDGETS.maxAgentTurns),
      maxToolCallsPerTurn: envInt("CORTADO_AGENT_TOOL_CALLS", DEFAULT_BUDGETS.maxToolCallsPerTurn),
      maxSwarmTurns: envInt("CORTADO_SWARM_TURNS", DEFAULT_BUDGETS.maxSwarmTurns),
      maxSwarmToolsPerTurn: envInt("CORTADO_SWARM_TOOLS", DEFAULT_BUDGETS.maxSwarmToolsPerTurn),
      proverMs: envInt("CORTADO_PROVER_MS", DEFAULT_BUDGETS.proverMs),
      maxProverCandidates: envInt("CORTADO_PROVER_CANDIDATES", DEFAULT_BUDGETS.maxProverCandidates),
      maxProverAttempts: envInt("CORTADO_PROVER_ATTEMPTS", DEFAULT_BUDGETS.maxProverAttempts),
      maxProverTurns: envInt("CORTADO_PROVER_TURNS", DEFAULT_BUDGETS.maxProverTurns),
      maxProverToolsPerTurn: envInt("CORTADO_PROVER_TOOLS", DEFAULT_BUDGETS.maxProverToolsPerTurn),
      maxProverEscalations: envIntAllowZero("CORTADO_PROVER_ESCALATIONS", DEFAULT_BUDGETS.maxProverEscalations),
      maxCostUsd: envFloat("CORTADO_MAX_COST_USD", DEFAULT_BUDGETS.maxCostUsd),
      baselineMs: envIntAllowZero("CORTADO_BASELINE_MS", DEFAULT_BUDGETS.baselineMs),
      ...overrides.budgets,
    }),
  };
}

/**
 * Projects the private model configuration (which carries the gateway key and
 * base URL) down to the public selection that is safe to persist and return.
 * Everything that records `result.models` must go through this (3.4).
 */
export function publicModelSelection(models: ModelsConfig): ModelSelection {
  return {
    luna: models.luna,
    terra: models.terra,
    codegen: models.codegen,
    astra: models.astra,
    reasoning: { ...models.reasoning },
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
    ...(settings.models?.codegen ? { codegen: settings.models.codegen } : {}),
    ...(settings.models?.astra ? { astra: settings.models.astra } : {}),
    reasoning: {
      luna: settings.reasoning?.luna ?? base.reasoning.luna,
      terra: settings.reasoning?.terra ?? base.reasoning.terra,
      codegen: settings.reasoning?.codegen ?? base.reasoning.codegen,
      astra: settings.reasoning?.astra ?? base.reasoning.astra,
    },
  };
}

interface ReviewRequestSettings {
  models?: Partial<Record<ModelRole, string>>;
  reasoning?: Partial<Record<ModelRole, ReasoningEffort>>;
}

export function mergeBudget(base: BudgetConfig, override?: Partial<BudgetConfig>): BudgetConfig {
  return clampBudgets(override ? { ...base, ...override } : base);
}

const MIN_STAGE_MS = 1_000;
const MIN_GLOBAL_MS = 5_000;

/**
 * Clamp budgets to sane minima so a malformed override can never produce a
 * silently empty "successful" run (3.3).
 */
export function clampBudgets(budgets: BudgetConfig): BudgetConfig {
  const stage = (value: number, fallback: number) => (Number.isFinite(value) && value > 0 ? Math.max(MIN_STAGE_MS, value) : fallback);
  const count = (value: number, fallback: number, min = 1) => (Number.isFinite(value) && value >= min ? Math.floor(value) : fallback);
  return {
    ...budgets,
    globalMs: Number.isFinite(budgets.globalMs) && budgets.globalMs > 0 ? Math.max(MIN_GLOBAL_MS, budgets.globalMs) : DEFAULT_BUDGETS.globalMs,
    sandboxSetupMs: stage(budgets.sandboxSetupMs, DEFAULT_BUDGETS.sandboxSetupMs),
    swarmMs: stage(budgets.swarmMs, DEFAULT_BUDGETS.swarmMs),
    judgeMs: stage(budgets.judgeMs, DEFAULT_BUDGETS.judgeMs),
    proofMs: stage(budgets.proofMs, DEFAULT_BUDGETS.proofMs),
    proverMs: stage(budgets.proverMs, DEFAULT_BUDGETS.proverMs),
    repairMs: stage(budgets.repairMs, DEFAULT_BUDGETS.repairMs),
    verifyMs: stage(budgets.verifyMs, DEFAULT_BUDGETS.verifyMs),
    astraMs: stage(budgets.astraMs, DEFAULT_BUDGETS.astraMs),
    baselineMs: Number.isFinite(budgets.baselineMs) && budgets.baselineMs >= 0 ? budgets.baselineMs : DEFAULT_BUDGETS.baselineMs,
    maxModelCalls: count(budgets.maxModelCalls, DEFAULT_BUDGETS.maxModelCalls),
    maxAgentAttempts: count(budgets.maxAgentAttempts, DEFAULT_BUDGETS.maxAgentAttempts),
    maxAgentTurns: count(budgets.maxAgentTurns, DEFAULT_BUDGETS.maxAgentTurns),
    maxToolCallsPerTurn: count(budgets.maxToolCallsPerTurn, DEFAULT_BUDGETS.maxToolCallsPerTurn),
    maxSwarmTurns: count(budgets.maxSwarmTurns, DEFAULT_BUDGETS.maxSwarmTurns),
    maxSwarmToolsPerTurn: count(budgets.maxSwarmToolsPerTurn, DEFAULT_BUDGETS.maxSwarmToolsPerTurn),
    maxProverCandidates: count(budgets.maxProverCandidates, DEFAULT_BUDGETS.maxProverCandidates),
    maxProverAttempts: count(budgets.maxProverAttempts, DEFAULT_BUDGETS.maxProverAttempts),
    maxProverTurns: count(budgets.maxProverTurns, DEFAULT_BUDGETS.maxProverTurns),
    maxProverToolsPerTurn: count(budgets.maxProverToolsPerTurn, DEFAULT_BUDGETS.maxProverToolsPerTurn),
    maxProverEscalations: Number.isFinite(budgets.maxProverEscalations) && budgets.maxProverEscalations >= 0 ? Math.floor(budgets.maxProverEscalations) : DEFAULT_BUDGETS.maxProverEscalations,
    maxRepairAttempts: count(budgets.maxRepairAttempts, DEFAULT_BUDGETS.maxRepairAttempts),
    maxCandidates: count(budgets.maxCandidates, DEFAULT_BUDGETS.maxCandidates),
    maxToProve: Number.isFinite(budgets.maxToProve) && budgets.maxToProve >= 0 ? Math.floor(budgets.maxToProve) : DEFAULT_BUDGETS.maxToProve,
    maxRepairs: Number.isFinite(budgets.maxRepairs) && budgets.maxRepairs >= 0 ? Math.floor(budgets.maxRepairs) : DEFAULT_BUDGETS.maxRepairs,
    maxBrowserChecks: count(budgets.maxBrowserChecks, DEFAULT_BUDGETS.maxBrowserChecks),
    maxCostUsd: Number.isFinite(budgets.maxCostUsd) && budgets.maxCostUsd >= 0 ? budgets.maxCostUsd : DEFAULT_BUDGETS.maxCostUsd,
  };
}

export { DEFAULT_MODELS };
