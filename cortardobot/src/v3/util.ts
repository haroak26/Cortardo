import { createHash } from "node:crypto";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Short, stable content hash used in cache keys and evidence records. */
export function hashContent(value: string): string {
  return sha256(value).slice(0, 24);
}

/** Deterministic JSON stringify (sorted object keys, stable arrays). */
export function stableStringify(value: unknown): string {
  // Only the active recursion path is tracked, so shared (non-circular)
  // references serialize fully instead of aliasing to "[circular]".
  const stack = new WeakSet<object>();
  const walk = (input: unknown): unknown => {
    if (input === null || typeof input !== "object") return input;
    if (stack.has(input as object)) return "[circular]";
    stack.add(input as object);
    let result: unknown;
    if (Array.isArray(input)) {
      result = input.map(walk);
    } else {
      const record = input as Record<string, unknown>;
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(record).sort()) out[key] = walk(record[key]);
      result = out;
    }
    stack.delete(input as object);
    return result;
  };
  return JSON.stringify(walk(value));
}

export function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n... [truncated ${value.length - max} chars]`;
}

const MAX_LEARNINGS = 20;
const MAX_LEARNING_CHARS = 300;

/** Trim, dedupe and bound repository learnings before they enter any prompt. */
export function normalizeLearnings(learnings?: string[]): string[] {
  if (!Array.isArray(learnings)) return [];
  const seen = new Set<string>();
  const items: string[] = [];
  for (const raw of learnings) {
    const value = String(raw ?? "").trim().replace(/\s+/g, " ");
    if (!value) continue;
    const item = value.length > MAX_LEARNING_CHARS ? `${value.slice(0, MAX_LEARNING_CHARS - 3)}...` : value;
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(item);
    if (items.length >= MAX_LEARNINGS) break;
  }
  return items;
}

/** Renders bounded learnings for prompt injection; undefined when there are none. */
export function renderLearnings(learnings?: string[], maxChars = 1_200): string | undefined {
  const items = normalizeLearnings(learnings);
  if (items.length === 0) return undefined;
  return truncate(items.map((item) => `- ${item}`).join("\n"), maxChars);
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

export interface TimeoutResult<T> {
  value: T;
  /** True when the timeout fired before the promise settled. */
  timedOut: boolean;
}

/**
 * Race a promise against a deadline. Unlike a bare `Promise.race` the caller
 * learns whether the fallback came from a timeout, and a rejection that lands
 * after the timeout is reported instead of becoming an unhandled rejection.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutValue: T,
  onLateError?: (error: unknown) => void,
): Promise<TimeoutResult<T>> {
  let timer: NodeJS.Timeout | undefined;
  let timedOut = false;
  const guarded = promise.catch((error) => {
    if (timedOut) {
      onLateError?.(error);
      return timeoutValue;
    }
    throw error;
  });
  try {
    return await Promise.race<TimeoutResult<T>>([
      guarded.then((value) => ({ value, timedOut: false })),
      new Promise<TimeoutResult<T>>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          resolve({ value: timeoutValue, timedOut: true });
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function stableId(prefix: string, ...parts: string[]): string {
  let hash = 2166136261;
  const input = parts.join("|");
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}_${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function extractJson<T = unknown>(text: string): T {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(trimmed.slice(first, last + 1)) as T;
      } catch {
        // fall through to the descriptive error below
      }
    }
    throw new Error(`could not extract JSON from model output: ${trimmed.slice(0, 160)}`);
  }
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/x-access-token:[^@\s]+@/gi, "x-access-token:***@"],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, "gh*_***"],
  [/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***"],
  [/sk-[A-Za-z0-9]{20,}/g, "sk-***"],
];

/** Removes credentials from any string before it is logged or persisted. */
export function redactSecrets(value: string): string {
  let redacted = value;
  for (const [pattern, replacement] of SECRET_PATTERNS) redacted = redacted.replace(pattern, replacement);
  return redacted;
}

export interface Logger {
  debug(message: string, detail?: Record<string, unknown>): void;
  info(message: string, detail?: Record<string, unknown>): void;
  warn(message: string, detail?: Record<string, unknown>): void;
  error(message: string, detail?: Record<string, unknown>): void;
}

export function createLogger(level: "debug" | "info" | "warn" | "error" = "info", scope = "v3"): Logger {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  const threshold = order[level];
  const log = (kind: keyof typeof order, message: string, detail?: Record<string, unknown>) => {
    if (order[kind] < threshold) return;
    const suffix = detail ? ` ${redactSecrets(JSON.stringify(detail)).slice(0, 800)}` : "";
    console.log(`[${new Date().toISOString()}] [${scope}] ${kind.toUpperCase()} ${redactSecrets(message)}${suffix}`);
  };
  return {
    debug: (m, d) => log("debug", m, d),
    info: (m, d) => log("info", m, d),
    warn: (m, d) => log("warn", m, d),
    error: (m, d) => log("error", m, d),
  };
}
