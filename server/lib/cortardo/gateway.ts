import { MergeGateway } from "merge-gateway-sdk";

const CORTARDO_MODEL = process.env.CORTARDO_MODEL || "zai/glm-5.3";
const CORTARDO_TITLE_MODEL = process.env.CORTARDO_TITLE_MODEL || "zai/glm-5.3";

/**
 * Maps the friendly model names shown in the UI to real gateway model ids.
 * The gateway only accepts `provider/model` (or bare base) ids — the UI's
 * display names ("GPT 5.6 Luna") must never be sent to it raw. Everything
 * is served by the default Cortardo model unless a mapping exists below.
 */
const UI_MODEL_MAP: Record<string, string> = {
  "GPT 5.6 Luna": CORTARDO_MODEL,
  "GPT 5.6 Terra": CORTARDO_MODEL,
  "GPT 5.6 Sol": CORTARDO_MODEL,
  "Gemini 3.1 Pro": CORTARDO_MODEL,
  "Gemini 3.7 Flash": CORTARDO_MODEL,
};

/** Resolves a UI model name (or raw gateway id) to a valid gateway model. */
export function resolveModel(model?: string | null): string {
  if (!model) return CORTARDO_MODEL;
  if (UI_MODEL_MAP[model]) return UI_MODEL_MAP[model];
  if (model.includes("/")) return model;
  return CORTARDO_MODEL;
}

export const PLAN_SYSTEM = `You are Cortardo, a friendly code review agent. The user just connected a repository and wants reviews on their pull requests.

Write a short, specific 1-2 sentence message to the user about what you will review and analyse next, referencing their actual code or PR. Do NOT write reasoning or chain-of-thought. Keep it under 35 words and avoid generic filler like "I'll set up your project".
Example: "I'll review the auth changes in this PR for race conditions and token handling, then check the new query helpers for N+1 patterns before leaving inline suggestions."`;

const REASONING_SYSTEM = `You are Cortardo, a senior code review agent. The user just submitted code for review.

Think through your approach out loud — in 2-4 genuine sentences: what you understand about the change, the risks and patterns you'll look for, and how you'll prioritise findings. This is your private working reasoning, not the final message to the user.

Be specific and grounded in their code. Avoid filler, clichés, and generic statements.`;

/**
 * Maps the UI reasoning dropdown (Medium / High / Extra High / Max) to the
 * reasoning effort understood by the model gateway. z.ai models (e.g.
 * glm-5.3) always think and accept low / high / max effort levels, so the
 * effort is sent via the OpenAI `reasoning: { effort }` parameter.
 */
function reasoningEffort(level?: string): string {
  switch ((level || "Medium").toLowerCase()) {
    case "max":
    case "extra high":
      return "max";
    case "high":
      return "high";
    default:
      return "medium";
  }
}

/**
 * Reasoning token cap used alongside the effort level. z.ai models always
 * think; without an explicit `budget_tokens` they can burn their whole output
 * budget on hidden reasoning (running away on complex prompts and returning
 * no answer). A budget bounds that so the final plan/answer always fits.
 */
function reasoningBudgetTokens(level?: string): number {
  switch ((level || "Medium").toLowerCase()) {
    case "max":
      return 8000;
    case "extra high":
      return 6000;
    case "high":
      return 3000;
    default:
      return 1500;
  }
}

/** Larger output budget for higher settings so the model can think longer. */
function reasoningMaxTokens(level?: string): number {
  switch ((level || "Medium").toLowerCase()) {
    case "max":
      return 32000;
    case "extra high":
      return 16000;
    case "high":
      return 8000;
    default:
      return 4000;
  }
}

/**
 * Pulls the model's *real* reasoning/thinking text out of a Responses-API
 * streaming snapshot. Covers both the OpenAI "reasoning" item shape and the
 * Merge Gateway "thinking" content-block shape.
 */
function extractReasoning(ev: unknown): string {
  const e: any = ev ?? {};
  let text = "";
  if (typeof e.reasoning === "string") text += e.reasoning;
  if (typeof e.thinking === "string") text += e.thinking;
  const out = Array.isArray(e.output) ? e.output : [];
  for (const item of out) {
    if (item?.type !== "reasoning" && item?.type !== "thinking") continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const block of content) {
      if (block?.type === "thinking" && typeof block.thinking === "string") text += block.thinking;
      else if (block?.type === "summary" && typeof block.text === "string") text += block.text;
      else if (block?.type === "text" && typeof block.text === "string") text += block.text;
    }
  }
  return text;
}

/** Pulls the final assistant answer out of a Responses-API streaming snapshot. */
function extractAnswer(ev: unknown): string {
  const e: any = ev ?? {};
  if (typeof e.output_text === "string") return e.output_text;
  const out = Array.isArray(e.output) ? e.output : [];
  let text = "";
  for (const item of out) {
    if (item?.type === "reasoning" || item?.type === "thinking") continue;
    if (typeof item?.text === "string") text += item.text;
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") text += block.text;
    }
  }
  return text;
}

let cachedClient: MergeGateway | null = null;

function getClient(): MergeGateway {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.MERGE_GATEWAY_API_KEY;
  if (!apiKey) {
    throw new Error("AI service not configured. Set MERGE_GATEWAY_API_KEY in your environment variables.");
  }
  cachedClient = new MergeGateway({
    apiKey,
    baseUrl: "https://api-gateway.merge.dev/v1",
    timeout: Number(process.env.CORTARDO_GATEWAY_TIMEOUT_MS) || 300000,
  });
  return cachedClient;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function extractText(response: unknown): string {
  const resp = response as {
    output?: Array<{ content?: unknown }>;
    output_text?: unknown;
  };
  if (typeof resp.output_text === "string") return resp.output_text;
  const first = resp.output?.[0]?.content;
  if (Array.isArray(first)) {
    return first
      .filter((b: any) => b?.type === "text" && typeof b.text === "string")
      .map((b: any) => b.text)
      .join("");
  }
  if (typeof first === "string") return first;
  return "";
}

/**
 * Streams a plain-text completion token-by-token. Used for the "what I'll do"
 * narration so the UI can reveal it live in the prompt box.
 */
/**
 * Pulls the full accumulated assistant text out of a single Responses-API
 * streaming event (MergeGateway sends whole snapshots, not deltas).
 */
function extractSnapshot(ev: unknown): string {
  const e: any = ev ?? {};
  // Top-level shortcuts
  if (typeof e.output_text === "string") return e.output_text;
  if (typeof e.text === "string") return e.text;
  if (typeof e.delta === "string") return e.delta;
  // Standard Responses shape: output[].content[].text
  const out = Array.isArray(e.output) ? e.output : [];
  for (const item of out) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const block of content) {
      if (block?.type === "text" && typeof block.text === "string") return block.text;
    }
  }
  return "";
}

/**
 * Streams the model's *real* reasoning (from its reasoning budget) plus the
 * final plan message, honouring the user's selected reasoning effort. If the
 * model exposes no reasoning items, it falls back to the synthetic narration
 * so the "Thinking" panel is never empty.
 */
export async function* streamReasoning(
  messages: ChatMessage[],
  opts: { model?: string; reasoning?: string; maxTokens?: number; temperature?: number } = {},
): AsyncGenerator<{ kind: "reasoning" | "plan" | "error"; text: string }> {
  const client = getClient();
  const model = resolveModel(opts.model);
  const userMessages = messages.filter((m) => m.role !== "system");
  const lastPrompt = userMessages.length ? userMessages[userMessages.length - 1].content : "";

  try {
    const stream = (await client.responses.create({
      model,
      input: messages.map((m) => ({ type: "message" as const, ...m })),
      // `reasoning` is not (yet) in the SDK's ResponseCreateParams but the
      // gateway accepts it and uses it to pick the model's reasoning effort.
      reasoning: { effort: reasoningEffort(opts.reasoning) as "low" | "medium" | "high" | "max" } as unknown as Record<string, unknown>,
      thinking: { type: "enabled", budget_tokens: reasoningBudgetTokens(opts.reasoning) },
      max_tokens: opts.maxTokens ?? reasoningMaxTokens(opts.reasoning),
      stream: true,
    } as any)) as unknown as { asyncIterator?: () => AsyncIterator<Record<string, unknown>> };

    const iter = (stream as any)[Symbol.asyncIterator]
      ? (stream as any)
      : (stream as any).asyncIterator
        ? (stream as any).asyncIterator()
        : null;
    if (!iter) {
      yield { kind: "error", text: "Reasoning stream unavailable" };
      return;
    }

    let lastReasoning = "";
    let lastAnswer = "";
    let gotReasoning = false;
    for await (const ev of iter) {
      const r = extractReasoning(ev);
      if (r.length > lastReasoning.length) {
        const delta = r.slice(lastReasoning.length);
        lastReasoning = r;
        if (delta) {
          gotReasoning = true;
          yield { kind: "reasoning", text: delta };
        }
      } else {
        lastReasoning = r;
      }
      const a = extractAnswer(ev);
      if (a.length > lastAnswer.length) {
        const delta = a.slice(lastAnswer.length);
        lastAnswer = a;
        if (delta) yield { kind: "plan", text: delta };
      } else {
        lastAnswer = a;
      }
    }

    // No reasoning surfaced (model/gateway didn't expose a thinking budget) —
    // fall back to the synthetic narration so the panel still has content.
    if (!gotReasoning) {
      for await (const delta of streamText(
        [{ role: "system", content: REASONING_SYSTEM }, ...userMessages],
        { maxTokens: 300, temperature: 0.7 },
      )) {
        yield { kind: "reasoning", text: delta };
      }
      yield { kind: "plan", text: await generatePlanText(lastPrompt) };
    }
  } catch (err) {
    console.error("[cortardo-agent] reasoning stream error:", err);
    try {
      for await (const delta of streamText(
        [{ role: "system", content: REASONING_SYSTEM }, ...userMessages],
        { maxTokens: 300, temperature: 0.7 },
      )) {
        yield { kind: "reasoning", text: delta };
      }
      yield { kind: "plan", text: await generatePlanText(lastPrompt) };
    } catch {
      yield { kind: "error", text: "Failed to generate reasoning" };
    }
  }
}

export async function generatePlanText(prompt: string): Promise<string> {
  const chunks: string[] = [];
  for await (const delta of streamText(
    [
      { role: "system", content: PLAN_SYSTEM },
      { role: "user", content: prompt },
    ],
    { maxTokens: 120, temperature: 0.6 },
  )) {
    chunks.push(delta);
  }
  const text = chunks.join("").trim();
  return text || "I'll explore a direction for your project and ask a few quick questions to tailor it.";
}

export async function* streamText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): AsyncGenerator<string> {
  const client = getClient();
  const stream = (await client.responses.create({
    model: CORTARDO_MODEL,
    input: messages.map((m) => ({ type: "message" as const, ...m })),
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 600,
    stream: true,
    thinking: { type: "enabled", budget_tokens: 256 },
  })) as unknown as { asyncIterator?: () => AsyncIterator<Record<string, unknown>> };

  const iter = (stream as any)[Symbol.asyncIterator]
    ? (stream as any)
    : (stream as any).asyncIterator
      ? (stream as any).asyncIterator()
      : null;
  if (!iter) return;

  let last = "";
  for await (const ev of iter) {
    const full = extractSnapshot(ev);
    if (!full) continue;
    // Events carry the whole text so far; emit only the new tail.
    if (full.length > last.length) {
      const delta = full.slice(last.length);
      last = full;
      if (delta) yield delta;
    } else {
      last = full;
    }
  }
}

/**
 * One-shot structured (JSON) completion. Used for the clarification questions
 * and the design artifacts. z.ai models like glm-5.3 do not support
 * `response_format: json_object` on the gateway, so JSON shape is enforced by
 * the system prompts ("Respond ONLY with JSON") and parsed robustly here.
 */
export async function completeJSON<T>(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
): Promise<T> {
  // The model occasionally returns prose instead of clean JSON; a single
  // retry resolves the vast majority of those cases cheaply.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const client = getClient();
      const response = await client.responses.create({
        model: CORTARDO_MODEL,
        input: messages.map((m) => ({ type: "message" as const, ...m })),
        temperature: opts.temperature ?? 0.5,
        // z.ai models always think; the small thinking budget keeps the hidden
        // reasoning bounded so the JSON rarely gets truncated by max_tokens.
        // The generous headroom below is the safety net for the same reason.
        max_tokens: opts.maxTokens ?? 4000,
        thinking: { type: "enabled", budget_tokens: 256 },
      });
      const raw = extractText(response);
      if (!raw.trim()) throw new Error("Empty response from Cortardo model");
      try {
        return parseJSON<T>(raw);
      } catch (err) {
        lastError = err;
        if (attempt === 0) {
          console.warn("[cortardo-agent] JSON parse failed, retrying…");
          continue;
        }
        throw err;
      }
    } catch (err) {
      lastError = err;
      if (attempt === 0 && !(err instanceof Error && err.message === "Cortardo model returned invalid JSON")) {
        console.warn("[cortardo-agent] JSON completion failed, retrying…", (err as Error)?.message);
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

/** Tolerant JSON parsing: direct parse, then code fences, then balanced braces. */
function parseJSON<T>(raw: string): T {
  const text = raw.trim();
  try {
    return JSON.parse(text) as T;
  } catch {
    // Strip ```json / ``` code fences if the model wrapped the payload.
    const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    if (fenced !== text) {
      try {
        return JSON.parse(fenced) as T;
      } catch {}
    }
    // Fall back to the first balanced { ... } block in the response.
    const start = fenced.indexOf("{");
    if (start !== -1) {
      let depth = 0;
      for (let i = start; i < fenced.length; i++) {
        if (fenced[i] === "{") depth++;
        else if (fenced[i] === "}") {
          depth--;
          if (depth === 0) {
            try {
              return JSON.parse(fenced.slice(start, i + 1)) as T;
            } catch {}
            break;
          }
        }
      }
    }
    throw new Error("Cortardo model returned invalid JSON");
  }
}

/**
 * One-shot plain-text completion using a configurable model. Used for fast,
 * background tasks like generating a short chat title with a small model.
 */
export async function completeText(
  messages: ChatMessage[],
  opts: { maxTokens?: number; temperature?: number } = {},
  model: string = CORTARDO_MODEL,
): Promise<string> {
  const client = getClient();
  const response = await client.responses.create({
    model,
    input: messages.map((m) => ({ type: "message" as const, ...m })),
    temperature: opts.temperature ?? 0.4,
    max_tokens: (opts.maxTokens ?? 200) + 400,
    thinking: { type: "enabled", budget_tokens: 256 },
  });
  return extractText(response).trim();
}

export const CORTARDO_MODEL_ID = CORTARDO_MODEL;
export const CORTARDO_TITLE_MODEL_ID = CORTARDO_TITLE_MODEL;
