const CLAIM_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "to",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "with",
  "this",
  "that",
  "it",
  "may",
  "might",
  "could",
  "can",
  "will",
  "would",
  "should",
  "potentially",
  "possibly",
  "likely",
  "issue",
  "bug",
  "problem",
  "code",
  "change",
  "changed",
]);

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return text.slice(0, max);
  return `${text.slice(0, max - 1)}…`;
}

export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const half = Math.floor((max - 1) / 2);
  return `${text.slice(0, half)}…${text.slice(text.length - half)}`;
}

export function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function claimKey(claim: string): string {
  const tokens = normalizeWhitespace(claim)
    .toLowerCase()
    .replace(/[`"'(){}[\],.;:!?<>]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0 && !CLAIM_STOPWORDS.has(token));
  return tokens.sort().join("-");
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/").replace(/^\/+/, "");
}

export function relativePath(from: string, to: string): string {
  const fromParts = normalizePath(from).split("/").slice(0, -1);
  const toParts = normalizePath(to).split("/");
  let common = 0;
  while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
    common++;
  }
  const up = fromParts.length - common;
  const down = toParts.slice(common);
  const parts = [...Array(up).fill(".."), ...down];
  const result = parts.join("/");
  return result.startsWith(".") ? result : `./${result}`;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

export function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
