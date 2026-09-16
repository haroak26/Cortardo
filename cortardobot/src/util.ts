import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Short, stable content hash used in artifact records and cache keys. */
export function hashContent(value: string): string {
  return sha256(value).slice(0, 24);
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

export function createLogger(level: "debug" | "info" | "warn" | "error" = "info", scope = "cortado-engine"): Logger {
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
