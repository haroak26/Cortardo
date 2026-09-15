import type { ModelClient, ModelResponse, ModelTask, Usage } from "./types";
import type { ModelsConfig } from "./config";

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
        return await this.request(task, task.expectJson !== false && this.config.jsonMode && this.jsonModeSupported);
      } catch (error) {
        lastError = error;
        if (error instanceof ModelError && !error.retryable) throw error;
        if (attempt < maxRetries) await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async request(task: ModelTask, useJsonMode: boolean): Promise<ModelResponse> {
    const started = Date.now();
    const timeoutMs = task.timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.config.apiKey}` },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: task.system },
            { role: "user", content: task.user },
          ],
          temperature: this.role === "luna" ? 0.1 : 0.2,
          max_tokens: Math.min(16_000, this.maxTokens(task)),
          ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
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
        return this.request(task, false);
      }
      throw new ModelError(`model request failed with status ${response.status}: ${raw.slice(0, 200)}`, false);
    }

    let parsed: { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } };
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
        return this.request(retryTask, useJsonMode);
      }
      throw new ModelError("model returned an empty completion", true);
    }
    if (text.startsWith("```")) {
      text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    }
    return {
      text,
      model: this.model,
      tokensIn: parsed.usage?.prompt_tokens ?? 0,
      tokensOut: parsed.usage?.completion_tokens ?? 0,
      durationMs: Date.now() - started,
      costUsd: parsed.usage?.cost,
    };
  }
}

export class ModelRouter {
  readonly usage: Usage = { calls: 0, byRole: {}, tokensIn: 0, tokensOut: 0, costUsd: 0, modelMs: 0 };
  private readonly clients: Record<"luna" | "terra" | "astra", ModelClient>;
  private readonly maxCalls: number;
  readonly dryRun: boolean;

  constructor(options: { clients: Partial<Record<"luna" | "terra" | "astra", ModelClient>>; config: ModelsConfig; maxCalls: number; dryRun?: boolean }) {
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
  }

  callsFor(role: "luna" | "terra" | "astra"): number {
    return this.usage.byRole[role] ?? 0;
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    if (this.usage.calls >= this.maxCalls) throw new ModelError(`model call budget exhausted (${this.maxCalls})`, false);
    this.usage.calls++;
    this.usage.byRole[task.role] = (this.usage.byRole[task.role] ?? 0) + 1;
    const response = await this.clients[task.role].complete(task);
    this.usage.tokensIn += response.tokensIn;
    this.usage.tokensOut += response.tokensOut;
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
