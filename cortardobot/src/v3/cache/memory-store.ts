import type { CacheHit, CacheSetInput, CacheStatsSnapshot } from "../types";
import { emptyCacheStats, type CacheStore } from "./store";

interface MemoryEntry {
  value: unknown;
  kind: string;
  createdAt: number;
  expiresAt: number | undefined;
  hits: number;
  meta?: Record<string, unknown>;
}

export interface MemoryCacheStoreOptions {
  maxEntries?: number;
}

/**
 * Process-local LRU + TTL cache. Used in tests and when the host does not
 * provide a persistent store.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly entries = new Map<string, MemoryEntry>();
  private readonly maxEntries: number;
  private readonly counters: CacheStatsSnapshot = emptyCacheStats();

  constructor(options: MemoryCacheStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 1_000;
  }

  async get<T>(key: string): Promise<CacheHit<T> | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    entry.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, entry);
    const kindStats = (this.counters.byKind[entry.kind] ??= { hits: 0, misses: 0, writes: 0 });
    kindStats.hits += 1;
    this.counters.hits += 1;
    return { value: entry.value as T, key, createdAt: entry.createdAt, hits: entry.hits, meta: entry.meta };
  }

  async set<T>(input: CacheSetInput<T>): Promise<void> {
    const kindStats = (this.counters.byKind[input.kind] ??= { hits: 0, misses: 0, writes: 0 });
    kindStats.writes += 1;
    this.counters.writes += 1;
    const now = Date.now();
    this.entries.delete(input.key);
    this.entries.set(input.key, {
      value: input.value,
      kind: input.kind,
      createdAt: now,
      expiresAt: input.ttlMs !== undefined ? now + input.ttlMs : undefined,
      hits: 0,
      meta: input.meta,
    });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  stats(): CacheStatsSnapshot {
    return {
      ...this.counters,
      byKind: Object.fromEntries(Object.entries(this.counters.byKind).map(([kind, value]) => [kind, { ...value }])),
    };
  }

  recordMiss(kind: string): void {
    const kindStats = (this.counters.byKind[kind] ??= { hits: 0, misses: 0, writes: 0 });
    kindStats.misses += 1;
    this.counters.misses += 1;
  }

  recordSaved(costUsd: number): void {
    this.counters.creditsSavedUsd += costUsd;
  }
}
