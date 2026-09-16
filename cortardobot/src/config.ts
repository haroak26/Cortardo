/**
 * Engine configuration. Budgets are soft: they gate starting new work and
 * never abort work in progress, so an exhausted budget produces an honest
 * partial result instead of a failed run.
 */
import type { ModelRole, ReasoningEffort } from "../../shared/models.ts";
import {
  DEFAULT_MODELS,
  DEFAULT_REASONING,
  MODEL_ENV_KEYS,
  REASONING_ENV_KEYS,
  parseReasoningEffort,
  resolveModelIds,
} from "../../shared/models.ts";

export interface ModelsConfig {
  investigator: string;
  engineer: string;
  reviewer: string;
  reasoning: Record<ModelRole, ReasoningEffort>;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  maxTokensInvestigator: number;
  maxTokensEngineer: number;
  maxTokensReviewer: number;
  jsonMode: boolean;
}

export interface SandboxConfig {
  template: string;
  apiKey: string;
  timeoutMs: number;
  repoDir: string;
  allowNetwork: boolean;
}

export interface BudgetConfig {
  globalMs: number;
  sandboxSetupMs: number;
  investigateMs: number;
  runtimeMs: number;
  fixMs: number;
  verifyMs: number;
  reportMs: number;
  maxModelCalls: number;
  /** Soft ceiling; when reached the run stops starting new work and completes. */
  maxCostUsd: number;
  investigate: {
    maxAgents: number;
    maxHypotheses: number;
    maxTurns: number;
    maxToolsPerTurn: number;
  };
  fix: {
    attempts: number;
    maxTurns: number;
    maxToolsPerTurn: number;
    diagnosisQuestions: number;
    refreshResearchers: number;
    refreshTurns: number;
  };
  verify: {
    maxTurns: number;
    maxToolsPerTurn: number;
  };
}

export interface EngineConfig {
  models: ModelsConfig;
  sandbox: SandboxConfig;
  budgets: BudgetConfig;
}

export const DEFAULT_BUDGETS: BudgetConfig = {
  globalMs: 1_800_000,
  sandboxSetupMs: 300_000,
  investigateMs: 600_000,
  runtimeMs: 480_000,
  fixMs: 900_000,
  verifyMs: 300_000,
  reportMs: 120_000,
  maxModelCalls: 160,
  maxCostUsd: 3,
  investigate: { maxAgents: 5, maxHypotheses: 2, maxTurns: 5, maxToolsPerTurn: 4 },
  fix: { attempts: 3, maxTurns: 6, maxToolsPerTurn: 5, diagnosisQuestions: 3, refreshResearchers: 3, refreshTurns: 2 },
  verify: { maxTurns: 4, maxToolsPerTurn: 4 },
};

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function envFloat(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export interface EngineConfigOverrides {
  models?: Partial<ModelsConfig>;
  sandbox?: Partial<SandboxConfig>;
  budgets?: Partial<Omit<BudgetConfig, "investigate" | "fix" | "verify">> & {
    investigate?: Partial<BudgetConfig["investigate"]>;
    fix?: Partial<BudgetConfig["fix"]>;
    verify?: Partial<BudgetConfig["verify"]>;
  };
}

export function resolveEngineConfig(overrides: EngineConfigOverrides = {}): EngineConfig {
  const ids = resolveModelIds({
    overrides: {
      investigator: overrides.models?.investigator,
      engineer: overrides.models?.engineer,
      reviewer: overrides.models?.reviewer,
    },
  });
  const reasoning: Record<ModelRole, ReasoningEffort> = {
    investigator:
      overrides.models?.reasoning?.investigator ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.investigator.primary]) ??
      DEFAULT_REASONING.investigator,
    engineer:
      overrides.models?.reasoning?.engineer ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.engineer.primary]) ??
      DEFAULT_REASONING.engineer,
    reviewer:
      overrides.models?.reasoning?.reviewer ??
      parseReasoningEffort(process.env[REASONING_ENV_KEYS.reviewer.primary]) ??
      DEFAULT_REASONING.reviewer,
  };
  const budgets = DEFAULT_BUDGETS;
  return {
    models: {
      investigator: ids.investigator,
      engineer: ids.engineer,
      reviewer: ids.reviewer,
      baseUrl: process.env.CORTADO_AI_BASE_URL ?? "https://api-gateway.merge.dev/v1/ai-sdk",
      apiKey:
        process.env.CORTADO_AI_API_KEY ??
        process.env.CORTARDO_BOT_MERGE_API_KEY ??
        process.env.MERGE_GATEWAY_API_KEY ??
        "",
      timeoutMs: envInt("CORTADO_MODEL_TIMEOUT_MS", 90_000),
      maxRetries: envInt("CORTADO_MODEL_RETRIES", 3),
      maxTokensInvestigator: envInt("CORTADO_MAX_TOKENS_INVESTIGATOR", 4_000),
      maxTokensEngineer: envInt("CORTADO_MAX_TOKENS_ENGINEER", 8_000),
      maxTokensReviewer: envInt("CORTADO_MAX_TOKENS_REVIEWER", 6_000),
      jsonMode: process.env.CORTADO_JSON_MODE !== "0",
      ...overrides.models,
      reasoning: { ...reasoning, ...(overrides.models?.reasoning ?? {}) },
    },
    sandbox: {
      template: process.env.CORTADO_E2B_TEMPLATE ?? "cortardo-review-v1",
      apiKey: process.env.E2B_API_KEY ?? "",
      timeoutMs: envInt("CORTADO_SANDBOX_TIMEOUT_MS", 900_000),
      repoDir: process.env.CORTADO_SANDBOX_REPO_DIR ?? "/home/user/repo",
      allowNetwork: process.env.CORTADO_SANDBOX_NETWORK !== "0",
      ...overrides.sandbox,
    },
    budgets: {
      globalMs: envInt("CORTADO_GLOBAL_TIMEOUT_MS", budgets.globalMs),
      sandboxSetupMs: envInt("CORTADO_SANDBOX_SETUP_MS", budgets.sandboxSetupMs),
      investigateMs: envInt("CORTADO_INVESTIGATE_MS", budgets.investigateMs),
      runtimeMs: envInt("CORTADO_RUNTIME_MS", budgets.runtimeMs),
      fixMs: envInt("CORTADO_FIX_MS", budgets.fixMs),
      verifyMs: envInt("CORTADO_VERIFY_MS", budgets.verifyMs),
      reportMs: envInt("CORTADO_REPORT_MS", budgets.reportMs),
      maxModelCalls: envInt("CORTADO_MODEL_CALL_BUDGET", budgets.maxModelCalls),
      maxCostUsd: envFloat("CORTADO_MAX_COST_USD", budgets.maxCostUsd),
      investigate: {
        maxAgents: envInt("CORTADO_INVESTIGATORS", budgets.investigate.maxAgents),
        maxHypotheses: envInt("CORTADO_HYPOTHESES_PER_AGENT", budgets.investigate.maxHypotheses),
        maxTurns: envInt("CORTADO_INVESTIGATOR_TURNS", budgets.investigate.maxTurns),
        maxToolsPerTurn: envInt("CORTADO_INVESTIGATOR_TOOLS", budgets.investigate.maxToolsPerTurn),
        ...overrides.budgets?.investigate,
      },
      fix: {
        attempts: envInt("CORTADO_FIX_ATTEMPTS", budgets.fix.attempts),
        maxTurns: envInt("CORTADO_FIX_TURNS", budgets.fix.maxTurns),
        maxToolsPerTurn: envInt("CORTADO_FIX_TOOLS", budgets.fix.maxToolsPerTurn),
        diagnosisQuestions: envInt("CORTADO_DIAGNOSIS_QUESTIONS", budgets.fix.diagnosisQuestions),
        refreshResearchers: envInt("CORTADO_REFRESH_RESEARCHERS", budgets.fix.refreshResearchers),
        refreshTurns: envInt("CORTADO_REFRESH_TURNS", budgets.fix.refreshTurns),
        ...overrides.budgets?.fix,
      },
      verify: {
        maxTurns: envInt("CORTADO_VERIFY_TURNS", budgets.verify.maxTurns),
        maxToolsPerTurn: envInt("CORTADO_VERIFY_TOOLS", budgets.verify.maxToolsPerTurn),
        ...overrides.budgets?.verify,
      },
    },
  };
}

/** Public projection — never carries the gateway key or base URL. */
export function publicModelSelection(models: ModelsConfig) {
  return {
    investigator: models.investigator,
    engineer: models.engineer,
    reviewer: models.reviewer,
    reasoning: { ...models.reasoning },
  };
}

export { DEFAULT_MODELS };
