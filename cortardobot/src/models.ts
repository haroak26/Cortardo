import type { ModelClient, ModelResponse, ModelRole, ModelTask, Usage } from "./types";
import type { ModelsConfig } from "./config";
import { catalogEntry } from "../../shared/models.ts";

/** Merge an optional caller signal with the per-request timeout signal. */
function combineSignals(timeout: AbortSignal, caller?: AbortSignal): AbortSignal {
  if (!caller) return timeout;
  if (caller.aborted || timeout.aborted) {
    const controller = new AbortController();
    controller.abort();
    return controller.signal;
  }
  const controller = new AbortController();
  const abort = () => controller.abort();
  timeout.addEventListener("abort", abort, { once: true });
  caller.addEventListener("abort", abort, { once: true });
  return controller.signal;
}

export class ModelError extends Error {
  readonly retryable: boolean;
  /** Server-requested delay before retrying (from Retry-After), when present. */
  readonly retryAfterMs?: number;
  constructor(message: string, retryable = false, retryAfterMs?: number) {
    super(message);
    this.name = "ModelError";
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(10_000, Math.round(seconds * 1000));
  const date = Date.parse(value);
  if (Number.isFinite(date)) return Math.min(10_000, Math.max(0, date - Date.now()));
  return undefined;
}

export class HttpModelClient implements ModelClient {
  readonly id: string;
  private readonly role: ModelRole;
  private readonly model: string;
  private readonly config: ModelsConfig;
  private readonly fetchImpl: typeof fetch;
  jsonModeSupported = true;
  /** Set once the gateway rejects reasoning_effort for this model. */
  private reasoningDisabled = false;
  /** Set once the gateway rejects a non-default temperature for this model. */
  private temperatureDisabled = false;
  /** Set once the gateway rejects max_tokens (e.g. gpt-6-astra) for this model. */
  private maxTokensParam: "max_tokens" | "max_completion_tokens" | "none" = "max_tokens";

  constructor(options: { role: ModelRole; model: string; config: ModelsConfig; fetchImpl?: typeof fetch }) {
    this.role = options.role;
    this.model = options.model;
    this.config = options.config;
    this.id = `http:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private maxTokens(task: ModelTask): number {
    if (task.maxTokens !== undefined) return task.maxTokens;
    if (this.role === "investigator") return this.config.maxTokensInvestigator;
    if (this.role === "engineer") return this.config.maxTokensEngineer;
    return this.config.maxTokensReviewer;
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    if (task.signal?.aborted) throw new ModelError("model request aborted before start", false);
    const maxRetries = task.retries ?? this.config.maxRetries;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (task.signal?.aborted) throw new ModelError("model request aborted", false);
      try {
        return await this.request(
          task,
          task.expectJson !== false && this.config.jsonMode && this.jsonModeSupported,
          !this.reasoningDisabled,
          0,
        );
      } catch (error) {
        lastError = error;
        if (task.signal?.aborted) throw new ModelError("model request aborted", false);
        if (error instanceof ModelError && !error.retryable) throw error;
        if (attempt < maxRetries) {
          const delay = error instanceof ModelError && error.retryAfterMs !== undefined ? error.retryAfterMs : 400 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async request(task: ModelTask, useJsonMode: boolean, useReasoning: boolean, depth = 0): Promise<ModelResponse> {
    if (depth > 6) throw new ModelError("model request gave up after too many capability fallbacks", false);
    if (task.signal?.aborted) throw new ModelError("model request aborted", false);
    const started = Date.now();
    const timeoutMs = task.timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const signal = combineSignals(controller.signal, task.signal);
    let response: Response;
    try {
      const reasoning = this.config.reasoning?.[this.role];
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: task.system },
            ...(task.history ?? []).map((message) => ({ role: message.role, content: message.content })),
            { role: "user", content: task.user },
          ],
          ...(this.temperatureDisabled ? {} : { temperature: this.role === "investigator" ? 0.1 : 0.2 }),
          ...(this.maxTokensParam !== "none" ? { [this.maxTokensParam]: Math.min(16_000, this.maxTokens(task)) } : {}),
          ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(reasoning && useReasoning ? { reasoning_effort: reasoning } : {}),
        }),
        signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ModelError(`model request failed: ${message}`, !task.signal?.aborted);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    if (response.status === 429 || response.status >= 500) {
      const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
      throw new ModelError(`transient upstream status ${response.status}: ${raw.slice(0, 160)}`, true, retryAfterMs);
    }
    if (!response.ok) {
      if (/response_format|json_object|json_schema|capability_unavailable/i.test(raw)) {
        this.jsonModeSupported = false;
        return this.request(task, false, useReasoning, depth + 1);
      }
      if (this.maxTokensParam !== "none" && /max_tokens|max_completion_tokens/i.test(raw)) {
        // Some gateways reject both spellings with the same misleading message;
        // the final fallback is to omit the token cap entirely.
        this.maxTokensParam = this.maxTokensParam === "max_tokens" ? "max_completion_tokens" : "none";
        return this.request(task, useJsonMode, useReasoning, depth + 1);
      }
      if (
        useReasoning &&
        /reasoning[_ ]?effort|unknown (?:field|parameter)|unsupported parameter|invalid parameter|unrecognized/i.test(raw)
      ) {
        this.reasoningDisabled = true;
        return this.request(task, useJsonMode, false, depth + 1);
      }
      if (!this.temperatureDisabled && /temperature/i.test(raw)) {
        // Reasoning-style models often only support the provider default.
        this.temperatureDisabled = true;
        return this.request(task, useJsonMode, useReasoning, depth + 1);
      }
      throw new ModelError(`model request failed with status ${response.status}: ${raw.slice(0, 200)}`, false);
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
      throw new ModelError(`model returned non-JSON body: ${raw.slice(0, 120)}`, true);
    }
    const choice = parsed.choices?.[0];
    let text = choice?.message?.content ?? "";
    if (!text.trim()) {
      if (choice?.finish_reason === "length") {
        // Bound the doubling so a gateway stuck on finish_reason:"length" can
        // never recurse forever at the 16k ceiling.
        const current = this.maxTokens(task);
        if (depth >= 3 || current >= 16_000) {
          throw new ModelError("model output was truncated at the token ceiling", true);
        }
        const retryTask = { ...task, maxTokens: Math.min(16_000, Math.round(current * 2)) };
        return this.request(retryTask, useJsonMode, useReasoning, depth + 1);
      }
      throw new ModelError("model returned an empty completion", true);
    }
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    const tokensIn = parsed.usage?.prompt_tokens ?? 0;
    const tokensOut = parsed.usage?.completion_tokens ?? 0;
    const cachedTokensIn = parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0;
    const entry = catalogEntry(this.model);
    const computedCost =
      entry !== undefined
        ? (tokensIn / 1_000_000) * entry.inputCostPerMillion +
          (tokensOut / 1_000_000) * entry.outputCostPerMillion
        : undefined;
    return {
      text,
      model: this.model,
      tokensIn,
      tokensOut,
      cachedTokensIn,
      durationMs: Date.now() - started,
      costUsd: parsed.usage?.cost ?? computedCost,
    };
  }
}

export interface ModelPreflightResult {
  checked: boolean;
  available: string[];
  missing: string[];
  warning?: string;
}

/**
 * Validate that the configured GPT models are actually served by the gateway.
 * Fails hard when the gateway lists its models and one is missing, or when the
 * key is rejected. When the gateway has no /models endpoint we warn and let the
 * first real call decide, so a transient outage never blocks a review.
 */
export async function preflightModels(
  config: ModelsConfig,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
): Promise<ModelPreflightResult> {
  const ids = [config.investigator, config.engineer, config.reviewer];
  if (!config.apiKey) {
    throw new ModelError("CORTADO_AI_API_KEY is not configured", false);
  }
  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/models`, {
      headers: { authorization: `Bearer ${config.apiKey}` },
    });
  } catch (error) {
    return {
      checked: false,
      available: [],
      missing: [],
      warning: `model preflight could not reach ${config.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ModelError(`model preflight rejected the gateway key (${response.status})`, false);
    }
    return {
      checked: false,
      available: [],
      missing: [],
      warning: `gateway /models returned ${response.status}; catalog check skipped`,
    };
  }
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    return { checked: false, available: [], missing: [], warning: "gateway /models returned a non-JSON body" };
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as { data?: unknown }).data)
      ? (parsed as { data: unknown[] }).data
      : [];
  const available = list
    .map((entry) => {
      if (typeof entry === "string") return entry;
      const record = entry as Record<string, unknown>;
      return String(record.id ?? record.model ?? record.name ?? "");
    })
    .filter(Boolean);
  if (available.length === 0) {
    return { checked: false, available, missing: [], warning: "gateway /models returned no entries; catalog check skipped" };
  }
  const bareId = (id: string) => id.slice(id.lastIndexOf("/") + 1);
  const availableExact = new Set(available);
  const availableBare = new Set(available.map(bareId));
  const missing = ids.filter((id) => !availableExact.has(id) && !availableBare.has(bareId(id)));
  if (missing.length > 0) {
    throw new ModelError(`selected model(s) not available on the gateway: ${missing.join(", ")}`, false);
  }
  return { checked: true, available, missing: [] };
}

export class ModelRouter {
  readonly usage: Usage = { calls: 0, byRole: {}, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, modelMs: 0 };
  private readonly clients: Record<ModelRole, ModelClient>;
  readonly maxCalls: number;
  readonly maxCostUsd: number;
  readonly dryRun: boolean;

  constructor(options: {
    clients: Partial<Record<ModelRole, ModelClient>>;
    config: ModelsConfig;
    maxCalls: number;
    dryRun?: boolean;
    /** Hard ceiling on accumulated cost; 0 disables. */
    maxCostUsd?: number;
  }) {
    this.dryRun = options.dryRun ?? false;
    const fallback = (role: ModelRole): ModelClient => {
      if (options.dryRun) return new ScriptedClient(role);
      return new HttpModelClient({ role, model: options.config[role], config: options.config });
    };
    this.clients = {
      investigator: options.clients.investigator ?? fallback("investigator"),
      engineer: options.clients.engineer ?? fallback("engineer"),
      reviewer: options.clients.reviewer ?? fallback("reviewer"),
    };
    this.maxCalls = options.maxCalls;
    this.maxCostUsd = options.maxCostUsd ?? 0;
  }

  callsFor(role: ModelRole): number {
    return this.usage.byRole[role] ?? 0;
  }

  /** Model id in use for a role — recorded in transcripts and run stats. */
  idFor(role: ModelRole): string {
    return this.clients[role].id;
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    if (this.usage.calls >= this.maxCalls) throw new ModelError(`model call budget exhausted (${this.maxCalls})`, false);
    if (this.maxCostUsd > 0 && this.usage.costUsd >= this.maxCostUsd) {
      throw new ModelError(`model cost budget exhausted ($${this.maxCostUsd.toFixed(2)})`, false);
    }
    this.usage.calls++;
    this.usage.byRole[task.role] = (this.usage.byRole[task.role] ?? 0) + 1;
    const response = await this.clients[task.role].complete(task);
    this.usage.tokensIn += response.tokensIn;
    this.usage.tokensOut += response.tokensOut;
    this.usage.cachedTokensIn += response.cachedTokensIn ?? 0;
    this.usage.modelMs += response.durationMs;
    if (typeof response.costUsd === "number") this.usage.costUsd = roundUsd(this.usage.costUsd + response.costUsd);
    return response;
  }
}

/** Micro-dollar rounding keeps accumulated usage from drifting. */
export function roundUsd(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/** Used only when running with mode "dry"; deterministic empty responses. */
class ScriptedClient implements ModelClient {
  readonly id: string;
  constructor(private readonly role: string) {
    this.id = `scripted:${role}`;
  }
  async complete(task: ModelTask): Promise<ModelResponse> {
    return { text: '{"decisions":[],"hypotheses":[],"reviews":[]}', model: this.id, tokensIn: 0, tokensOut: 0, durationMs: 0 };
  }
}
