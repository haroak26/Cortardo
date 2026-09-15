import type { CacheHit, CacheSetInput, CacheStatsSnapshot } from "../types";

/**
 * Versioned, content-addressed cache used to skip expensive model calls on
 * repeated or similar work. Implementations: MemoryCacheStore (tests/process
 * lifetime) and a DB-backed store supplied by the host server.
 */
export interface CacheStore {
  get<T>(key: string): Promise<CacheHit<T> | undefined>;
  set<T>(input: CacheSetInput<T>): Promise<void>;
  delete(key: string): Promise<void>;
  stats(): CacheStatsSnapshot;
  /** Count a lookup that found nothing (per-kind reporting). */
  recordMiss(kind: string): void;
  /** Record credits a cache hit avoided (for reporting). */
  recordSaved(costUsd: number): void;
}

export function emptyCacheStats(): CacheStatsSnapshot {
  return { hits: 0, misses: 0, writes: 0, byKind: {}, creditsSavedUsd: 0 };
}
