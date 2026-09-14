import type { Severity } from "./types";

export interface ModelConfig {
  luna: string;
  terra: string;
  astra: string;
  baseUrl: string;
  apiKey?: string;
  inputPricePerMTokens: number;
  outputPricePerMTokens: number;
  maxRetries: number;
  timeoutMs: number;
  jsonMode: boolean;
  maxTokensLuna: number;
  maxTokensTerra: number;
  maxTokensAstra: number;
}

export interface SwarmConfig {
  tiny: number;
  normal: number;
  complex: number;
  maxHypothesesPerAgent: number;
  concurrency: number;
}

export interface JudgeConfig {
  maxToProve: number;
  maxToProveComplex: number;
  minConfidence: number;
  minSeverity: Severity;
  maxCandidates: number;
}

export interface ProofConfig {
  maxHypotheses: number;
  perHypothesisMs: number;
  totalMs: number;
  maxStrategies: number;
}

export interface RepairConfig {
  maxAttempts: number;
  maxTimeMs: number;
  maxToolCalls: number;
  maxPatchBytes: number;
}

export interface VerifyConfig {
  totalMs: number;
}

export interface SandboxConfig {
  root?: string;
  allowNetwork: boolean;
  setupTimeoutMs: number;
  warmDependencies: boolean;
}

export interface ConfigRoot {
  mode: "dry" | "live";
  now?: () => number;
  models: ModelConfig;
  swarm: SwarmConfig;
  judge: JudgeConfig;
  proof: ProofConfig;
  repair: RepairConfig;
  verify: VerifyConfig;
  sandbox: SandboxConfig;
  globalTimeoutMs: number;
}

export type CortadoConfig = ConfigRoot;

export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

export const SEVERITY_ORDER: Severity[] = ["info", "low", "medium", "high", "critical"];

export function severityRank(severity: Severity): number {
  return SEVERITY_ORDER.indexOf(severity);
}

export function maxSeverity(a: Severity, b: Severity): Severity {
  return severityRank(a) >= severityRank(b) ? a : b;
}

export const DEFAULT_CONFIG: ConfigRoot = {
  mode: "dry",
  models: {
    luna: process.env.CORTADO_MODEL_LUNA ?? "gpt-5.6-luna",
    terra: process.env.CORTADO_MODEL_TERRA ?? "gpt-5.6-terra",
    astra: process.env.CORTADO_MODEL_ASTRA ?? "gpt-6-astra",
    baseUrl: process.env.CORTADO_AI_BASE_URL ?? "https://api.openai.com/v1",
    apiKey: process.env.CORTADO_AI_API_KEY,
    inputPricePerMTokens: 2,
    outputPricePerMTokens: 8,
    maxRetries: 2,
    timeoutMs: Number(process.env.CORTADO_MODEL_TIMEOUT_MS ?? 45_000),
    jsonMode: process.env.CORTADO_JSON_MODE !== "0",
    maxTokensLuna: Number(process.env.CORTADO_MAX_TOKENS_LUNA ?? 1200),
    maxTokensTerra: Number(process.env.CORTADO_MAX_TOKENS_TERRA ?? 2000),
    maxTokensAstra: Number(process.env.CORTADO_MAX_TOKENS_ASTRA ?? 2000),
  },
  swarm: {
    tiny: 3,
    normal: 8,
    complex: 12,
    maxHypothesesPerAgent: 2,
    concurrency: 4,
  },
  judge: {
    maxToProve: 3,
    maxToProveComplex: 5,
    minConfidence: 0.5,
    minSeverity: "medium",
    maxCandidates: 10,
  },
  proof: {
    maxHypotheses: 5,
    perHypothesisMs: 30_000,
    totalMs: 60_000,
    maxStrategies: 6,
  },
  repair: {
    maxAttempts: 3,
    maxTimeMs: 45_000,
    maxToolCalls: 12,
    maxPatchBytes: 200_000,
  },
  verify: {
    totalMs: 60_000,
  },
  sandbox: {
    allowNetwork: false,
    setupTimeoutMs: 15_000,
    warmDependencies: false,
  },
  globalTimeoutMs: 180_000,
};

function mergeSection<T extends object>(base: T, override?: Partial<T>): T {
  return override ? { ...base, ...override } : base;
}

export function resolveConfig(overrides?: DeepPartial<ConfigRoot>): ConfigRoot {
  const mode =
    overrides?.mode ??
    (process.env.CORTADO_AI_API_KEY && process.env.CORTADO_MODE !== "dry" ? "live" : "dry");
  return {
    ...DEFAULT_CONFIG,
    ...overrides,
    mode,
    models: mergeSection(DEFAULT_CONFIG.models, overrides?.models),
    swarm: mergeSection(DEFAULT_CONFIG.swarm, overrides?.swarm),
    judge: mergeSection(DEFAULT_CONFIG.judge, overrides?.judge),
    proof: mergeSection(DEFAULT_CONFIG.proof, overrides?.proof),
    repair: mergeSection(DEFAULT_CONFIG.repair, overrides?.repair),
    verify: mergeSection(DEFAULT_CONFIG.verify, overrides?.verify),
    sandbox: mergeSection(DEFAULT_CONFIG.sandbox, overrides?.sandbox),
    globalTimeoutMs: overrides?.globalTimeoutMs ?? DEFAULT_CONFIG.globalTimeoutMs,
    now: overrides?.now,
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends (...args: never[]) => unknown ? T[K] : DeepPartial<T[K]>) : T[K];
};

export function creditsFromTokens(tokensIn: number, tokensOut: number, models: ModelConfig): number {
  const usd =
    (tokensIn / 1_000_000) * models.inputPricePerMTokens +
    (tokensOut / 1_000_000) * models.outputPricePerMTokens;
  const credits = usd * 1000;
  return Math.round(credits * 1000) / 1000;
}

export const AGENT_LIMITS: Record<"tiny" | "normal" | "complex", number> = {
  tiny: DEFAULT_CONFIG.swarm.tiny,
  normal: DEFAULT_CONFIG.swarm.normal,
  complex: DEFAULT_CONFIG.swarm.complex,
};
