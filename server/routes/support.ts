import type { Express, Response } from "express";
import { apiRateLimiter, requireAuth } from "./helpers";
import {
  SUPPORT_AGENT_BLOCKED_MESSAGE,
  SUPPORT_AGENT_GUARD_MODEL,
  SUPPORT_AGENT_MAX_CHARS,
  SUPPORT_AGENT_MODEL,
  buildSupportAgentSystemPrompt,
  buildSupportGuardSystemPrompt,
  buildSupportTitlePrompt,
  cleanSupportChatTitle,
  supportChatRequestSchema,
  supportTitleRequestSchema,
} from "@shared/support";

/**
 * ServiceBot endpoints. The browser owns the page tools; this route only talks
 * to OpenRouter (OpenAI-compatible) and returns the model's next reply. The
 * client loop executes actions and asks again.
 *
 * A small Mistral guard model screens each new user turn before the main
 * GLM 5.3 Flash call, and a tiny title call names each conversation.
 *
 * Keys are tried in order so a spent or rate-limited key falls through to the
 * next configured one instead of failing the chat.
 */

const REQUEST_TIMEOUT_MS = 45_000;
/* GLM 5.3 Flash is a thinking model: the ceiling covers reasoning + reply. */
const MAX_OUTPUT_TOKENS = 3_000;
const TRANSIENT_RETRY_DELAY_MS = 500;

function gatewayConfig() {
  const baseUrl = process.env.CORTADO_AI_BASE_URL?.trim() || "https://openrouter.ai/api/v1";
  const keys = [
    process.env.SUPPORT_AGENT_API_KEY,
    process.env.OPENROUTER_API_KEY,
    process.env.CORTADO_AI_API_KEY,
    process.env.CODEBOT_API_KEY,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  const model = process.env.SUPPORT_AGENT_MODEL?.trim() || SUPPORT_AGENT_MODEL;
  const guardModel = process.env.SUPPORT_AGENT_GUARD_MODEL?.trim() || SUPPORT_AGENT_GUARD_MODEL;
  return { baseUrl, keys: [...new Set(keys)], model, guardModel };
}

type WireMessage = { role: string; content: string };

interface GatewayFailure extends Error {
  status?: number;
  kind?: "key" | "transient" | "param";
  upstream?: string;
}

function failure(message: string, status?: number, kind?: GatewayFailure["kind"], upstream?: string): GatewayFailure {
  return Object.assign(new Error(message), { status, kind, upstream });
}

interface CompletionOptions {
  model?: string;
  jsonMode?: boolean;
  maxTokens?: number;
  temperature?: number;
}

/**
 * Capability ladder: the gateway rejects unknown params for some models, so
 * drop optional fields one rung at a time instead of failing the call.
 */
function requestBodies(
  model: string,
  messages: WireMessage[],
  options: Required<CompletionOptions>,
): Array<Record<string, unknown>> {
  const base = { model, messages };
  const bodies: Array<Record<string, unknown>> = [];
  if (options.jsonMode) {
    bodies.push({ ...base, temperature: options.temperature, max_tokens: options.maxTokens, response_format: { type: "json_object" } });
  }
  bodies.push({ ...base, temperature: options.temperature, max_tokens: options.maxTokens });
  bodies.push({ ...base, max_tokens: options.maxTokens });
  bodies.push({ ...base });
  return bodies;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function upstreamMessage(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } | string; message?: string };
    const error = parsed.error;
    if (typeof error === "string") return error;
    if (error?.message) return error.message;
    if (parsed.message) return parsed.message;
  } catch {
    /* fall through to raw */
  }
  return raw.replace(/\s+/g, " ").trim().slice(0, 200);
}

async function requestOnce(
  baseUrl: string,
  apiKey: string,
  body: Record<string, unknown>,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    const upstream = upstreamMessage(raw);
    if (response.status === 402 && /in-flight requests|available credits/i.test(raw)) {
      throw failure(upstream || "provider busy (402)", response.status, "transient", upstream);
    }
    if (response.status === 401 || response.status === 402 || response.status === 403) {
      throw failure(upstream || "gateway key rejected", response.status, "key", upstream);
    }
    if (response.status === 429 || response.status >= 500) {
      throw failure(upstream || `gateway busy (${response.status})`, response.status, "transient", upstream);
    }
    if (!response.ok) {
      const lower = raw.toLowerCase();
      const paramRejected = ["temperature", "max_tokens", "max_completion_tokens", "response_format"].some((field) =>
        lower.includes(field),
      );
      throw failure(upstream || `gateway error (${response.status})`, response.status, paramRejected ? "param" : undefined, upstream);
    }
    let parsed: { choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }> };
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw failure("gateway returned a non-JSON body", response.status, "transient", upstream);
    }
    const choice = parsed.choices?.[0];
    const text = choice?.message?.content?.trim() ?? "";
    if (!text) {
      // Thinking models can burn the whole budget on reasoning; treat as
      // transient so the ladder / next key gets a chance.
      throw failure("gateway returned an empty reply", response.status, "transient", upstream);
    }
    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw failure("ServiceBot timed out", undefined, "transient");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function completeWithGateway(messages: WireMessage[], options: CompletionOptions = {}): Promise<string> {
  const { baseUrl, keys, model } = gatewayConfig();
  if (keys.length === 0) {
    throw failure("ServiceBot is not configured", 503, "key");
  }
  const resolved: Required<CompletionOptions> = {
    model: options.model ?? model,
    jsonMode: options.jsonMode ?? false,
    maxTokens: options.maxTokens ?? MAX_OUTPUT_TOKENS,
    temperature: options.temperature ?? 0.3,
  };
  const bodies = requestBodies(resolved.model, messages, resolved);
  let last: GatewayFailure = failure("ServiceBot request failed");

  for (const apiKey of keys) {
    for (const body of bodies) {
      try {
        return await requestOnce(baseUrl, apiKey, body);
      } catch (error) {
        last = error instanceof Error ? (error as GatewayFailure) : failure(String(error));
        if (last.kind === "key") break;
        if (last.kind === "transient") await delay(TRANSIENT_RETRY_DELAY_MS);
      }
    }
  }

  const status = last.status;
  if (status === 401 || status === 403) {
    throw failure("ServiceBot gateway key is invalid", 502, "key", last.upstream);
  }
  if (status === 402) {
    throw failure("ServiceBot credits are exhausted on the gateway", 502, "key", last.upstream);
  }
  throw failure(last.upstream || last.message || "ServiceBot request failed", 502, last.kind, last.upstream);
}

/** Exported for direct testing; `registerSupportRoutes` is the only caller in the app. */
export async function completeSupportAgentChat(messages: WireMessage[]): Promise<string> {
  return completeWithGateway(messages, { jsonMode: true, maxTokens: MAX_OUTPUT_TOKENS, temperature: 0.3 });
}

/**
 * Mistral guard: true when the prompt is about the app/page. Fails open so a
 * gateway hiccup never blocks legitimate questions.
 */
export async function supportPromptAllowed(gate: string): Promise<boolean> {
  const { guardModel } = gatewayConfig();
  try {
    const text = await completeWithGateway(
      [
        { role: "system", content: buildSupportGuardSystemPrompt() },
        { role: "user", content: gate },
      ],
      { model: guardModel, jsonMode: false, maxTokens: 8, temperature: 0 },
    );
    if (/\bblock\b/i.test(text)) return false;
    return true;
  } catch {
    return true;
  }
}

/** Short AI-generated conversation title; falls back to a local truncation. */
export async function generateSupportChatTitle(message: string, reply?: string): Promise<string> {
  const { model } = gatewayConfig();
  try {
    const text = await completeWithGateway(
      [
        { role: "system", content: "You name chat sessions. Reply with the title only." },
        { role: "user", content: buildSupportTitlePrompt(message, reply) },
      ],
      { model, jsonMode: false, maxTokens: 60, temperature: 0.4 },
    );
    const title = cleanSupportChatTitle(text);
    if (title) return title;
  } catch {
    /* fall through to local title */
  }
  return cleanSupportChatTitle(message);
}

export function registerSupportRoutes(app: Express) {
  app.post("/api/support/chat", requireAuth, apiRateLimiter, async (req, res: Response) => {
    const parsed = supportChatRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid support request" });
    }
    const { messages, page, gate } = parsed.data;
    const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
    if (totalChars > SUPPORT_AGENT_MAX_CHARS) {
      return res.status(413).json({ message: "This conversation is too long — start a new one." });
    }
    if (gate) {
      const allowed = await supportPromptAllowed(gate);
      if (!allowed) {
        return res.json({
          text: JSON.stringify({ message: SUPPORT_AGENT_BLOCKED_MESSAGE, actions: [], done: true }),
        });
      }
    }
    try {
      const text = await completeSupportAgentChat([
        { role: "system", content: buildSupportAgentSystemPrompt(page) },
        ...messages.map((message) => ({ role: message.role, content: message.content })),
      ]);
      res.json({ text });
    } catch (error) {
      const message = error instanceof Error ? error.message : "ServiceBot request failed";
      res.status(502).json({ message });
    }
  });

  app.post("/api/support/title", requireAuth, apiRateLimiter, async (req, res: Response) => {
    const parsed = supportTitleRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: "Invalid title request" });
    }
    const title = await generateSupportChatTitle(parsed.data.message, parsed.data.reply);
    res.json({ title: title || "New chat" });
  });
}
