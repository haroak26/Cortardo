import type { ModelClient, ModelResponse, ModelTask, Usage } from "./types";
import type { ModelsConfig } from "./config";
import { catalogEntry } from "../../../shared/models.ts";

export class ModelError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = false) {
    super(message);
    this.name = "ModelError";
    this.retryable = retryable;
  }
}

export class HttpModelClient implements ModelClient {
  readonly id: string;
  private readonly role: "luna" | "terra" | "astra";
  private readonly model: string;
  private readonly config: ModelsConfig;
  private readonly fetchImpl: typeof fetch;
  jsonModeSupported = true;
  /** Set once the gateway rejects reasoning_effort for this model. */
  private reasoningDisabled = false;

  constructor(options: { role: "luna" | "terra" | "astra"; model: string; config: ModelsConfig; fetchImpl?: typeof fetch }) {
    this.role = options.role;
    this.model = options.model;
    this.config = options.config;
    this.id = `http:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private maxTokens(task: ModelTask): number {
    if (task.maxTokens !== undefined) return task.maxTokens;
    if (this.role === "luna") return this.config.maxTokensLuna;
    if (this.role === "terra") return this.config.maxTokensTerra;
    return this.config.maxTokensAstra;
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    const maxRetries = task.retries ?? this.config.maxRetries;
    let lastError: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.request(
          task,
          task.expectJson !== false && this.config.jsonMode && this.jsonModeSupported,
          !this.reasoningDisabled,
        );
      } catch (error) {
        lastError = error;
        if (error instanceof ModelError && !error.retryable) throw error;
        if (attempt < maxRetries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async request(task: ModelTask, useJsonMode: boolean, useReasoning: boolean): Promise<ModelResponse> {
    const started = Date.now();
    const timeoutMs = task.timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
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
          temperature: this.role === "luna" ? 0.1 : 0.2,
          max_tokens: Math.min(16_000, this.maxTokens(task)),
          ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
          ...(reasoning && useReasoning ? { reasoning_effort: reasoning } : {}),
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ModelError(`model request failed: ${error instanceof Error ? error.message : String(error)}`, true);
    } finally {
      clearTimeout(timer);
    }

    const raw = await response.text();
    if (response.status === 429 || response.status >= 500) {
      throw new ModelError(`transient upstream status ${response.status}: ${raw.slice(0, 160)}`, true);
    }
    if (!response.ok) {
      if (/response_format|json_object|json_schema|capability_unavailable/i.test(raw)) {
        this.jsonModeSupported = false;
        return this.request(task, false, useReasoning);
      }
      if (
        useReasoning &&
        /reasoning[_ ]?effort|unknown (?:field|parameter)|unsupported parameter|invalid parameter|unrecognized/i.test(raw)
      ) {
        this.reasoningDisabled = true;
        return this.request(task, useJsonMode, false);
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
        const retryTask = { ...task, maxTokens: Math.min(16_000, Math.round(this.maxTokens(task) * 2)) };
        return this.request(retryTask, useJsonMode, useReasoning);
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
  const ids = [config.luna, config.terra, config.astra];
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
  private readonly clients: Record<"luna" | "terra" | "astra", ModelClient>;
  private readonly maxCalls: number;
  private readonly maxCostUsd: number;
  readonly dryRun: boolean;

  constructor(options: {
    clients: Partial<Record<"luna" | "terra" | "astra", ModelClient>>;
    config: ModelsConfig;
    maxCalls: number;
    dryRun?: boolean;
    /** Hard ceiling on accumulated cost; 0 disables. */
    maxCostUsd?: number;
  }) {
    this.dryRun = options.dryRun ?? false;
    const fallback = (role: "luna" | "terra" | "astra"): ModelClient => {
      if (options.dryRun) return new ScriptedClient(role);
      return new HttpModelClient({ role, model: options.config[role], config: options.config });
    };
    this.clients = {
      luna: options.clients.luna ?? fallback("luna"),
      terra: options.clients.terra ?? fallback("terra"),
      astra: options.clients.astra ?? fallback("astra"),
    };
    this.maxCalls = options.maxCalls;
    this.maxCostUsd = options.maxCostUsd ?? 0;
  }

  callsFor(role: "luna" | "terra" | "astra"): number {
    return this.usage.byRole[role] ?? 0;
  }

  /** Model id in use for a role — recorded in transcripts and run stats. */
  idFor(role: "luna" | "terra" | "astra"): string {
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
    if (typeof response.costUsd === "number") this.usage.costUsd += response.costUsd;
    return response;
  }
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
