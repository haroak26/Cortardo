import type { ModelClient, ModelResponse, ModelTask } from "./types";
import { estimateTokens } from "../util/text";
import { retry } from "../util/async";
import type { ModelConfig } from "../config";

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { message?: string; code?: string };
}

export class NonRetryableModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NonRetryableModelError";
  }
}

export class JsonModeUnsupportedError extends NonRetryableModelError {
  constructor(message: string) {
    super(message);
    this.name = "JsonModeUnsupportedError";
  }
}

export interface OpenAiCompatibleOptions {
  role: "luna" | "terra" | "astra";
  model: string;
  config: ModelConfig;
  fetchImpl?: typeof fetch;
}

export class OpenAiCompatibleClient implements ModelClient {
  readonly id: string;
  readonly dryRun = false;
  private readonly role: "luna" | "terra" | "astra";
  private readonly model: string;
  private readonly config: ModelConfig;
  private readonly fetchImpl: typeof fetch;
  private jsonModeSupported: boolean | null = null;
  private tokenBump = 1;

  constructor(options: OpenAiCompatibleOptions) {
    this.role = options.role;
    this.model = options.model;
    this.config = options.config;
    this.id = `live:${options.model}`;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private maxTokensFor(task: ModelTask): number {
    if (task.maxTokens !== undefined) return task.maxTokens;
    if (this.role === "luna") return this.config.maxTokensLuna;
    if (this.role === "terra") return this.config.maxTokensTerra;
    return this.config.maxTokensAstra;
  }

  async complete(task: ModelTask): Promise<ModelResponse> {
    const useJsonMode = Boolean(task.expectJson && this.config.jsonMode && this.jsonModeSupported !== false);
    try {
      return await this.request(task, useJsonMode);
    } catch (error) {
      if (error instanceof JsonModeUnsupportedError) {
        this.jsonModeSupported = false;
        return this.request(task, false);
      }
      throw error;
    }
  }

  private buildBody(task: ModelTask, useJsonMode: boolean): Record<string, unknown> {
    return {
      model: this.model,
      messages: [
        { role: "system", content: task.system },
        { role: "user", content: task.user },
      ],
      temperature: task.role === "luna" ? 0.1 : 0.2,
      max_tokens: Math.min(16_000, Math.round(this.maxTokensFor(task) * this.tokenBump)),
      ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    };
  }

  private async request(task: ModelTask, useJsonMode: boolean): Promise<ModelResponse> {
    const started = Date.now();

    const data = await retry(
      async () => {
        const timeoutMs = task.timeoutMs ?? this.config.timeoutMs;
        const controller = new AbortController();
        const timer =
          Number.isFinite(timeoutMs) && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
        try {
          const response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${this.config.apiKey ?? ""}`,
            },
            body: JSON.stringify(this.buildBody(task, useJsonMode)),
            signal: controller.signal,
          });
          const raw = await response.text();
          if (response.status === 429 || response.status >= 500) {
            throw new Error(`transient upstream status ${response.status}`);
          }
          if (!response.ok) {
            if (/capability_unavailable|json_schema|json_object|response_format/i.test(raw)) {
              throw new JsonModeUnsupportedError(`gateway rejected JSON mode: ${raw.slice(0, 200)}`);
            }
            let message = `model request failed with status ${response.status}`;
            try {
              const parsed = JSON.parse(raw) as ChatCompletionResponse;
              message = parsed.error?.message ?? message;
            } catch {
              // non-JSON error body
            }
            throw new NonRetryableModelError(message);
          }
          const parsedBody = JSON.parse(raw) as ChatCompletionResponse;
          const choice = parsedBody.choices?.[0];
          const content = choice?.message?.content ?? "";
          if (choice && !content.trim()) {
            if (choice.finish_reason === "length") {
              this.tokenBump = Math.min(this.tokenBump * 1.75, 4);
              throw new Error("empty completion: reasoning consumed the token budget, retrying with a larger budget");
            }
            throw new NonRetryableModelError("model returned an empty completion");
          }
          return parsedBody;
        } finally {
          if (timer) clearTimeout(timer);
        }
      },
      {
        retries: this.config.maxRetries,
        delayMs: 250,
        shouldRetry: (error) => !(error instanceof NonRetryableModelError),
      },
    );

    const text = data.choices?.[0]?.message?.content ?? "";
    return {
      text,
      model: this.model,
      tokensIn: data.usage?.prompt_tokens ?? estimateTokens(task.system + task.user),
      tokensOut: data.usage?.completion_tokens ?? estimateTokens(text),
      durationMs: Date.now() - started,
      costUsd: data.usage?.cost,
    };
  }
}
