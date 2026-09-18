/**
 * Minimal gateway client for the hypothesis stage. This is a small client with
 * capability fallbacks that keep the gateway honest (json mode, token caps,
 * reasoning, temperature), plus per-role usage accounting and a soft cost
 * budget shared by the coordinator and the swarm.
 */
import { catalogEntry, parseReasoningEffort, type ReasoningEffort } from "@shared/models";
import { HYPOTHESIS_SEVERITIES, type HypothesisSeverity } from "./types.ts";

/** Coordinator (master agent): plans the investigation and synthesizes it. */
export const BETABOT_DEFAULT_COORDINATOR_MODEL = "openai/gpt-5.6-terra";
/** Swarm (investigator): reads the code and gathers evidence per assignment. */
export const BETABOT_DEFAULT_SWARM_MODEL = "openai/gpt-5.6-luna";
/** Codegen (engineer): writes the fix for a planned hypothesis. */
export const BETABOT_DEFAULT_CODEGEN_MODEL = "openai/gpt-5.6-sol";
export const BETABOT_DEFAULT_MODEL = BETABOT_DEFAULT_COORDINATOR_MODEL;

export type BetabotModelRole = "coordinator" | "swarm" | "codegen";

export interface BetabotModelConfig {
  /** Coordinator (master agent) model — the one a plain client calls. */
  model: string;
  /** Swarm (investigator) model. */
  swarmModel: string;
  /** Codegen (engineer) model. */
  codegenModel: string;
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  maxTokens: number;
  /** Output ceiling for swarm investigators; falls back to `maxTokens`. */
  swarmMaxTokens?: number;
  /** Output ceiling for codegen; falls back to `maxTokens`. */
  codegenMaxTokens?: number;
  reasoning: ReasoningEffort;
  /** Reasoning effort for the codegen model; defaults to minimal to save cost. */
  codegenReasoning: ReasoningEffort;
  /** Send prompt_cache_key so the gateway serves the shared prefix from cache. */
  promptCacheEnabled?: boolean;
}

export interface BetabotSwarmConfig {
  /** Maximum assignments handed to swarm agents. */
  maxAgents: number;
  /** Maximum swarm agents in flight at once. */
  concurrency: number;
  /** Maximum model turns per swarm agent. */
  maxTurns: number;
  /** Maximum tool executions per swarm turn. */
  maxToolsPerTurn: number;
  /** Hard per-run cost ceiling shared by coordinator, swarm and codegen. */
  maxCostUsd: number;
  /** Soft goal for a run; budgets are allocated to stay near it. */
  targetCostUsd?: number;
  /** Slice of `maxCostUsd` reserved for stage 4 (verify/apply). */
  reserveUsd?: number;
  /** Stage 2 allocation; defaults to a share of the target. */
  stage2BudgetUsd?: number;
  /** Whole-stage wall-clock budget. */
  timeoutMs: number;
  /** Allow the swarm to use the gateway code search. */
  searchEnabled: boolean;
  /** Honor stored repository learnings (dismissals). */
  learningsEnabled: boolean;
  /** Maximum fixes to attempt; 0 means every hypothesis. */
  maxFixes: number;
  /** Severities that are allowed into codegen and sandbox verification. */
  fixSeverities: HypothesisSeverity[];
  /** Codegen agents in flight at once. */
  codegenConcurrency: number;
  /** Maximum model turns per codegen agent. */
  codegenTurns: number;
  /** Run stage 4 in sandboxes; 0 disables it without a crash. */
  verifyEnabled: boolean;
  /** Sandbox verify attempts per fix: 1 initial + repairs, capped at 4. */
  verifyAttempts: number;
  /** Whole stage-4 wall clock. */
  verifyTimeoutMs: number;
  /** Ceiling for a single sandbox command. */
  verifyCommandTimeoutMs: number;
  /** Explicit verification commands; bypasses terra's plan when set. */
  verifyCommands: string[];
  /** E2B template with Node, git and npm. */
  e2bTemplate: string;
  /** How long the sandbox stays alive. */
  e2bTimeoutMs: number;
}

export const BETABOT_DEFAULT_FIX_SEVERITIES: HypothesisSeverity[] = ["critical", "high"];

function parseSeverities(value: string | undefined): HypothesisSeverity[] {
  if (value === undefined) return [...BETABOT_DEFAULT_FIX_SEVERITIES];
  const known = new Set<string>(HYPOTHESIS_SEVERITIES);
  const parsed = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => known.has(entry)) as HypothesisSeverity[];
  return [...new Set(parsed)];
}

/** A copy of the config that calls the swarm model instead of the coordinator. */
export function swarmModelConfig(config: BetabotModelConfig): BetabotModelConfig {
  return { ...config, model: config.swarmModel, maxTokens: config.swarmMaxTokens ?? config.maxTokens };
}

/** A copy of the config that calls the codegen model instead of the coordinator. */
export function codegenModelConfig(config: BetabotModelConfig): BetabotModelConfig {
  return {
    ...config,
    model: config.codegenModel,
    maxTokens: config.codegenMaxTokens ?? config.maxTokens,
    reasoning: config.codegenReasoning,
  };
}

function envInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function envFloat(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function resolveBetabotModelConfig(env: Record<string, string | undefined> = process.env): BetabotModelConfig {
  return {
    model: env.BETABOT_MODEL?.trim() || BETABOT_DEFAULT_COORDINATOR_MODEL,
    swarmModel: env.BETABOT_SWARM_MODEL?.trim() || BETABOT_DEFAULT_SWARM_MODEL,
    codegenModel: env.BETABOT_CODEGEN_MODEL?.trim() || BETABOT_DEFAULT_CODEGEN_MODEL,
    baseUrl: env.CORTADO_AI_BASE_URL?.trim() || "https://api-gateway.merge.dev/v1/ai-sdk",
    apiKey:
      // Explicit override first so an exhausted project key can be swapped
      // without touching the shared CORTADO_AI_* configuration.
      env.BETABOT_API_KEY?.trim() ||
      env.CORTADO_AI_API_KEY?.trim() ||
      env.CORTARDO_BOT_MERGE_API_KEY?.trim() ||
      env.MERGE_GATEWAY_API_KEY?.trim() ||
      // Workspace fallback for local validation runs.
      env.OPENCODE_MERGE_KEY?.trim() ||
      "",
    timeoutMs: envInt(env.BETABOT_MODEL_TIMEOUT_MS, 60_000),
    maxRetries: envInt(env.BETABOT_MODEL_RETRIES, 1),
    maxTokens: envInt(env.BETABOT_MODEL_MAX_TOKENS, 4_000),
    swarmMaxTokens: envInt(env.BETABOT_SWARM_MAX_TOKENS, 2_000),
    codegenMaxTokens: envInt(env.BETABOT_CODEGEN_MAX_TOKENS, 1_500),
    reasoning: parseReasoningEffort(env.BETABOT_REASONING) ?? "medium",
    codegenReasoning: parseReasoningEffort(env.BETABOT_REASONING_CODEGEN) ?? "minimal",
    promptCacheEnabled: env.BETABOT_PROMPT_CACHE !== "0",
  };
}

export function resolveBetabotSwarmConfig(env: Record<string, string | undefined> = process.env): BetabotSwarmConfig {
  return {
    maxAgents: envInt(env.BETABOT_SWARM_AGENTS, 6),
    concurrency: envInt(env.BETABOT_SWARM_CONCURRENCY, 3),
    maxTurns: envInt(env.BETABOT_SWARM_TURNS, 3),
    maxToolsPerTurn: envInt(env.BETABOT_SWARM_TOOLS, 3),
    maxCostUsd: envFloat(env.BETABOT_MAX_COST_USD, 0.5),
    targetCostUsd: envFloat(env.BETABOT_TARGET_COST_USD, 0.4),
    reserveUsd: envFloat(env.BETABOT_STAGE4_RESERVE_USD, 0.15),
    stage2BudgetUsd: envFloat(env.BETABOT_STAGE2_BUDGET, 0.22),
    timeoutMs: envInt(env.BETABOT_HYPOTHESES_MS, 300_000),
    searchEnabled: env.BETABOT_SWARM_SEARCH !== "0",
    learningsEnabled: env.BETABOT_LEARNINGS !== "0",
    maxFixes: envInt(env.BETABOT_MAX_FIXES, 0),
    fixSeverities: parseSeverities(env.BETABOT_FIX_SEVERITIES),
    codegenConcurrency: envInt(env.BETABOT_CODEGEN_CONCURRENCY, 2),
    codegenTurns: envInt(env.BETABOT_CODEGEN_TURNS, 2),
    verifyEnabled: env.BETABOT_VERIFY !== "0",
    verifyAttempts: Math.min(4, Math.max(1, envInt(env.BETABOT_VERIFY_ATTEMPTS, 4))),
    verifyTimeoutMs: envInt(env.BETABOT_VERIFY_MS, 900_000),
    verifyCommandTimeoutMs: envInt(env.BETABOT_VERIFY_COMMAND_TIMEOUT_MS, 300_000),
    verifyCommands: (env.BETABOT_VERIFY_COMMANDS ?? "")
      .split("\n")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
    e2bTemplate: env.BETABOT_E2B_TEMPLATE?.trim() || env.CORTADO_E2B_TEMPLATE?.trim() || "cortardo-review-v1",
    e2bTimeoutMs: envInt(env.BETABOT_E2B_TIMEOUT_MS, 900_000),
  };
}

export class BetabotModelError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "BetabotModelError";
    this.retryable = retryable;
  }
}

export interface BetabotModelCompletion {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  /** Prompt tokens served from the provider's cache, when reported. */
  cachedTokensIn?: number;
  costUsd?: number;
  durationMs: number;
}

export interface BetabotMessage {
  role: "user" | "assistant";
  content: string;
}

export interface BetabotCompleteInput {
  system: string;
  user: string;
  history?: BetabotMessage[];
  signal?: AbortSignal;
  /** Gateway cache key for the shared prompt prefix (prompt_cache_key). */
  cacheKey?: string;
  /** Hard ceiling for this call's output, set by the budget admission. */
  maxOutputTokens?: number;
}

export interface BetabotModelClient {
  readonly id: string;
  complete(input: BetabotCompleteInput): Promise<BetabotModelCompletion>;
}

export interface BetabotRoleUsage {
  id: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn: number;
  costUsd: number;
  /** Calls that failed on transport or admission and cost nothing recorded. */
  failedCalls: number;
}

export function emptyRoleUsage(id: string): BetabotRoleUsage {
  return { id, calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, failedCalls: 0 };
}

function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export interface BetabotUsageTrackerOptions {
  /** Soft goal the budget allocation aims at; reported only. */
  targetCostUsd?: number;
  /** Slice of `maxCostUsd` that stages 1-3 may never spend (stage 4). */
  reserveUsd?: number;
}

/**
 * Per-role usage plus the shared cost ceiling. The ceiling is per run:
 * `beginStage` narrows it further for a stage, and `reserve`/`release` keep
 * concurrent in-flight calls from overshooting it.
 */
export class BetabotUsageTracker {
  readonly usage: Record<BetabotModelRole, BetabotRoleUsage>;
  readonly targetCostUsd: number;
  readonly reserveUsd: number;

  private reservedUsd = 0;
  private stage: { name: string; capUsd: number; startCostUsd: number; includeReserve: boolean } | undefined;

  constructor(
    readonly maxCostUsd: number,
    options: BetabotUsageTrackerOptions = {},
  ) {
    this.usage = {
      coordinator: emptyRoleUsage(""),
      swarm: emptyRoleUsage(""),
      codegen: emptyRoleUsage(""),
    };
    this.targetCostUsd = options.targetCostUsd ?? maxCostUsd;
    this.reserveUsd = Math.max(0, Math.min(options.reserveUsd ?? 0, maxCostUsd));
  }

  get totalCostUsd(): number {
    return roundUsd(this.usage.coordinator.costUsd + this.usage.swarm.costUsd + this.usage.codegen.costUsd);
  }

  get totalCalls(): number {
    return this.usage.coordinator.calls + this.usage.swarm.calls + this.usage.codegen.calls;
  }

  get totalFailedCalls(): number {
    return this.usage.coordinator.failedCalls + this.usage.swarm.failedCalls + this.usage.codegen.failedCalls;
  }

  /** Ceiling stages 1-3 may spend, after the stage 4 reserve. */
  get spendableUsd(): number {
    return Math.max(0, this.maxCostUsd - this.reserveUsd);
  }

  /** Remaining budget for the active stage, respecting the run ceiling. */
  get remainingUsd(): number {
    const ceiling = this.stage?.includeReserve ? this.maxCostUsd : this.spendableUsd;
    const runLeft = ceiling - this.totalCostUsd - this.reservedUsd;
    if (!this.stage) return Math.max(0, runLeft);
    const stageLeft = this.stage.capUsd - (this.totalCostUsd - this.stage.startCostUsd) - this.reservedUsd;
    return Math.max(0, Math.min(runLeft, stageLeft));
  }

  get exhausted(): boolean {
    return this.maxCostUsd > 0 && this.remainingUsd <= 0;
  }

  /**
   * Cap the next segment of work; `capUsd` is its own slice of the run.
   * `includeReserve` unlocks the slice stages 1-3 may never spend, for the
   * final stage the reserve belongs to.
   */
  beginStage(name: string, capUsd?: number, options: { includeReserve?: boolean } = {}): void {
    const includeReserve = options.includeReserve === true;
    const ceiling = includeReserve ? this.maxCostUsd : this.spendableUsd;
    const budget = capUsd && capUsd > 0 ? Math.min(capUsd, ceiling) : ceiling;
    this.stage = { name, capUsd: budget, startCostUsd: this.totalCostUsd, includeReserve };
  }

  /** Final-stage budget: everything left, including the stage-4 reserve. */
  beginReservedStage(name: string): void {
    this.beginStage(name, Math.max(0, this.maxCostUsd - this.totalCostUsd), { includeReserve: true });
  }

  canAfford(estimatedUsd: number): boolean {
    if (this.maxCostUsd === 0) return true;
    return estimatedUsd <= this.remainingUsd;
  }

  reserve(estimatedUsd: number): void {
    this.reservedUsd = roundUsd(this.reservedUsd + estimatedUsd);
  }

  release(estimatedUsd: number): void {
    this.reservedUsd = Math.max(0, roundUsd(this.reservedUsd - estimatedUsd));
  }

  record(role: BetabotModelRole, completion: BetabotModelCompletion): void {
    const usage = this.usage[role];
    usage.id = completion.model;
    usage.calls += 1;
    usage.tokensIn += completion.tokensIn;
    usage.tokensOut += completion.tokensOut;
    usage.cachedTokensIn += completion.cachedTokensIn ?? 0;
    usage.costUsd = roundUsd(usage.costUsd + (completion.costUsd ?? 0));
  }

  recordFailure(role: BetabotModelRole): void {
    this.usage[role].failedCalls += 1;
  }
}

/** Fallback rates for models missing from the catalog: the priciest known. */
const FALLBACK_INPUT_RATE = 7.5;
const FALLBACK_OUTPUT_RATE = 37.5;
const FALLBACK_CACHED_RATE = 0.75;

export interface BetabotPricing {
  modelId: string;
  maxOutputTokens: number;
}

/** Conservative pre-call estimate: full-rate input, catalog output. */
export function estimateCallCost(input: BetabotCompleteInput, pricing: BetabotPricing): number {
  const entry = catalogEntry(pricing.modelId);
  const inputRate = entry?.inputCostPerMillion ?? FALLBACK_INPUT_RATE;
  const outputRate = entry?.outputCostPerMillion ?? FALLBACK_OUTPUT_RATE;
  const chars =
    input.system.length +
    input.user.length +
    (input.history ?? []).reduce((total, message) => total + message.content.length, 0);
  const inputTokens = Math.ceil(chars / 4);
  return (inputTokens / 1_000_000) * inputRate + (pricing.maxOutputTokens / 1_000_000) * outputRate;
}

/**
 * Wraps a client so every call counts against the shared budget. With pricing
 * it also admits calls against the remaining budget and clamps their output,
 * so a single call cannot blow the run ceiling.
 */
export class BudgetedModelClient implements BetabotModelClient {
  constructor(
    private readonly inner: BetabotModelClient,
    private readonly tracker: BetabotUsageTracker,
    private readonly role: BetabotModelRole,
    private readonly pricing?: BetabotPricing,
  ) {}

  get id(): string {
    return this.inner.id;
  }

  async complete(input: BetabotCompleteInput): Promise<BetabotModelCompletion> {
    if (this.tracker.exhausted) {
      throw new BetabotModelError(`model cost budget exhausted ($${this.tracker.maxCostUsd.toFixed(2)})`, false);
    }
    if (!this.pricing) {
      const completion = await this.inner.complete(input);
      this.tracker.record(this.role, completion);
      return completion;
    }
    const estimate = estimateCallCost(input, this.pricing);
    if (!this.tracker.canAfford(estimate)) {
      throw new BetabotModelError(
        `model cost budget would be exceeded (estimated $${estimate.toFixed(4)}, $${this.tracker.remainingUsd.toFixed(4)} left of $${this.tracker.maxCostUsd.toFixed(2)})`,
        false,
      );
    }
    this.tracker.reserve(estimate);
    try {
      const completion = await this.inner.complete({ ...input, maxOutputTokens: this.pricing.maxOutputTokens });
      this.tracker.record(this.role, completion);
      return completion;
    } catch (error) {
      this.tracker.recordFailure(this.role);
      throw error;
    } finally {
      this.tracker.release(estimate);
    }
  }
}

/** Thrown when a model call is blocked purely by the cost budget. */
export function isBetabotBudgetError(error: unknown): boolean {
  return error instanceof BetabotModelError && /cost budget/.test(error.message);
}

/** Attributes every completion to the agent holding it (per-assignment/fix). */
export class BetabotUsageCollectingClient implements BetabotModelClient {
  readonly usage = { calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0 };

  constructor(private readonly inner: BetabotModelClient) {}

  get id(): string {
    return this.inner.id;
  }

  async complete(input: BetabotCompleteInput): Promise<BetabotModelCompletion> {
    const completion = await this.inner.complete(input);
    this.usage.calls += 1;
    this.usage.tokensIn += completion.tokensIn;
    this.usage.tokensOut += completion.tokensOut;
    this.usage.cachedTokensIn += completion.cachedTokensIn ?? 0;
    this.usage.costUsd += completion.costUsd ?? 0;
    return completion;
  }
}

/** Run-scoped tracker with the target and stage 4 reserve from the config. */
export function createBetabotUsageTracker(config: BetabotSwarmConfig): BetabotUsageTracker {
  return new BetabotUsageTracker(config.maxCostUsd, {
    targetCostUsd: config.targetCostUsd,
    reserveUsd: config.reserveUsd,
  });
}

/** Stable prompt_cache_key shared by every call of one role in one run. */
export function betabotCacheKey(
  role: BetabotModelRole,
  input: { repository: string; pullRequestNumber: number; headSha: string },
): string {
  return `betabot:${role}:${input.repository}:${input.pullRequestNumber}:${input.headSha.slice(0, 12)}`;
}

function combineSignals(timeout: AbortSignal, caller?: AbortSignal): AbortSignal {
  if (!caller) return timeout;
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (caller.aborted || timeout.aborted) controller.abort();
  else {
    timeout.addEventListener("abort", abort, { once: true });
    caller.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class HttpBetabotModelClient implements BetabotModelClient {
  readonly id: string;
  private jsonModeSupported = true;
  private reasoningDisabled = false;
  private temperatureDisabled = false;
  private promptCacheKeySupported = true;
  private maxTokensParam: "max_tokens" | "max_completion_tokens" | "none" = "max_tokens";
  private readonly supportsReasoning: boolean;

  constructor(
    private readonly config: BetabotModelConfig,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {
    this.id = `http:${config.model}`;
    this.supportsReasoning = catalogEntry(config.model)?.supportsReasoning ?? false;
  }

  async complete(input: BetabotCompleteInput): Promise<BetabotModelCompletion> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.maxRetries; attempt += 1) {
      if (input.signal?.aborted) throw new BetabotModelError("model request aborted", false);
      try {
        return await this.request(input, this.requestOptions(), 0);
      } catch (error) {
        lastError = error;
        if (!(error instanceof BetabotModelError) || !error.retryable) throw error;
        if (attempt < this.config.maxRetries) await delay(400 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new BetabotModelError(String(lastError), false);
  }

  /** Capability choices for one request; captured per call so concurrent
   * calls cannot race each other's fallbacks. */
  private requestOptions(): {
    jsonMode: boolean;
    maxTokensParam: "max_tokens" | "max_completion_tokens" | "none";
    reasoning: boolean;
    temperature: boolean;
    promptCacheKey: boolean;
  } {
    return {
      jsonMode: this.jsonModeSupported,
      maxTokensParam: this.maxTokensParam,
      reasoning: this.supportsReasoning && !this.reasoningDisabled,
      temperature: !this.temperatureDisabled,
      promptCacheKey: this.config.promptCacheEnabled !== false && this.promptCacheKeySupported,
    };
  }

  private async request(
    input: BetabotCompleteInput,
    options: ReturnType<HttpBetabotModelClient["requestOptions"]>,
    depth: number,
  ): Promise<BetabotModelCompletion> {
    if (depth > 6) throw new BetabotModelError("model request gave up after too many capability fallbacks", false);
    const started = Date.now();
    if (input.signal?.aborted) throw new BetabotModelError("model request aborted", false);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    const signal = combineSignals(controller.signal, input.signal);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: input.system },
            ...(input.history ?? []).map((message) => ({ role: message.role, content: message.content })),
            { role: "user", content: input.user },
          ],
          ...(options.temperature ? { temperature: 0.2 } : {}),
          ...(options.maxTokensParam !== "none"
            ? {
                [options.maxTokensParam]: Math.min(
                  16_000,
                  input.maxOutputTokens ?? this.config.maxTokens,
                ),
              }
            : {}),
          ...(options.jsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(options.reasoning ? { reasoning_effort: this.config.reasoning } : {}),
          ...(options.promptCacheKey && input.cacheKey ? { prompt_cache_key: input.cacheKey } : {}),
        }),
        signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BetabotModelError(`model request failed: ${message}`, !input.signal?.aborted);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    if (response.status === 429 || response.status >= 500) {
      throw new BetabotModelError(`transient upstream status ${response.status}: ${raw.slice(0, 160)}`, true);
    }
    if (!response.ok) {
      // Fallbacks are decided by what THIS request actually sent, so two
      // concurrent calls cannot disable each other's recovery.
      for (const field of ["reasoning_effort", "reasoning", "temperature", "max_tokens", "max_completion_tokens", "response_format", "prompt_cache_key"] as const) {
        if (!raw.includes(field)) continue;
        if (field === "response_format" && options.jsonMode) {
          this.jsonModeSupported = false;
          return this.request(input, { ...options, jsonMode: false }, depth + 1);
        }
        if (field === "prompt_cache_key" && options.promptCacheKey) {
          this.promptCacheKeySupported = false;
          return this.request(input, { ...options, promptCacheKey: false }, depth + 1);
        }
        if ((field === "max_tokens" || field === "max_completion_tokens") && options.maxTokensParam !== "none") {
          const next = this.maxTokensParam === "max_tokens" ? "max_completion_tokens" : "none";
          this.maxTokensParam = next;
          return this.request(input, { ...options, maxTokensParam: next }, depth + 1);
        }
        if ((field === "reasoning_effort" || field === "reasoning") && options.reasoning) {
          this.reasoningDisabled = true;
          return this.request(input, { ...options, reasoning: false }, depth + 1);
        }
        if (field === "temperature" && options.temperature) {
          this.temperatureDisabled = true;
          return this.request(input, { ...options, temperature: false }, depth + 1);
        }
      }
      if (/provider_error|temporarily|overloaded|try again|rate limit|timed out/i.test(raw)) {
        throw new BetabotModelError(`transient provider error: ${raw.slice(0, 200)}`, true);
      }
      throw new BetabotModelError(`model request failed with status ${response.status}: ${raw.slice(0, 200)}`, false);
    }

    let parsed: {
      choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        cost?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new BetabotModelError(`model returned a non-JSON body: ${raw.slice(0, 120)}`, true);
    }
    const choice = parsed.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";
    if (!text) {
      if (choice?.finish_reason === "length") {
        throw new BetabotModelError("model output was truncated at the token ceiling", true);
      }
      throw new BetabotModelError("model returned an empty completion", true);
    }
    const tokensIn = parsed.usage?.prompt_tokens ?? 0;
    const tokensOut = parsed.usage?.completion_tokens ?? 0;
    const cachedTokensIn = Math.min(parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0, tokensIn);
    const entry = catalogEntry(this.config.model);
    // Unknown models fall back to the priciest catalog rates so a custom model
    // can never slip past the budget for free.
    const inputRate = entry?.inputCostPerMillion ?? FALLBACK_INPUT_RATE;
    const outputRate = entry?.outputCostPerMillion ?? FALLBACK_OUTPUT_RATE;
    const cachedRate = entry?.cachedInputCostPerMillion ?? Math.min(FALLBACK_CACHED_RATE, inputRate);
    const uncachedTokensIn = Math.max(0, tokensIn - cachedTokensIn);
    const computedCost =
      (uncachedTokensIn / 1_000_000) * inputRate +
      (cachedTokensIn / 1_000_000) * cachedRate +
      (tokensOut / 1_000_000) * outputRate;
    return {
      text,
      model: this.config.model,
      tokensIn,
      tokensOut,
      cachedTokensIn,
      costUsd: parsed.usage?.cost ?? computedCost,
      durationMs: Date.now() - started,
    };
  }
}

export function createBetabotModelClient(config: BetabotModelConfig = resolveBetabotModelConfig()): BetabotModelClient {
  return new HttpBetabotModelClient(config);
}
