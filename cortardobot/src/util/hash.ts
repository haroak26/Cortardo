export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function shortHash(input: string, length = 8): string {
  const hex = fnv1a(input);
  if (length <= 8) return hex.slice(0, length);
  let out = hex;
  let salt = 0;
  while (out.length < length) {
    out += fnv1a(`${input}:${salt++}`);
  }
  return out.slice(0, length);
}

export function stableId(prefix: string, ...parts: Array<string | number | undefined | null>): string {
  const key = parts.filter((part) => part !== undefined && part !== null).join("|");
  return `${prefix}_${shortHash(key || prefix)}`;
}
