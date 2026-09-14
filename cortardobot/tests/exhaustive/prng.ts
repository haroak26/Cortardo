export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function pick<T>(rand: () => number, items: T[]): T {
  return items[Math.floor(rand() * items.length)];
}

export function randomString(rand: () => number, length: number, alphabet = "abcdefghijklmnopqrstuvwxyz0123456789 "): string {
  let out = "";
  for (let index = 0; index < length; index++) {
    out += alphabet[Math.floor(rand() * alphabet.length)];
  }
  return out;
}

export function randomLines(rand: () => number, count: number, prefix = "line"): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index} ${randomString(rand, randomInt(rand, 3, 12))}`);
}
