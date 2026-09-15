import { eq, sql } from "drizzle-orm";
import { db } from "../../db";
import { reviewCacheEntries } from "@shared/schema";
import type { CacheHit, CacheSetInput, CacheStatsSnapshot } from "../../../cortardobot/src/v3/types.ts";
import type { CacheStore } from "../../../cortardobot/src/v3/cache/store.ts";
import { ensureReviewSchema } from "./schema";

/**
 * Postgres-backed coalescing cache used by live review runs. Counters are
 * process-local (for reporting); the entries themselves survive restarts.
 */
export class DbCacheStore implements CacheStore {
  private readonly counters: CacheStatsSnapshot = { hits: 0, misses: 0, writes: 0, byKind: {}, creditsSavedUsd: 0 };
  private ready: Promise<void> | undefined;

  private async ensure(): Promise<void> {
    this.ready ??= ensureReviewSchema();
    await this.ready;
  }

  private kindStats(kind: string): { hits: number; misses: number; writes: number } {
    return (this.counters.byKind[kind] ??= { hits: 0, misses: 0, writes: 0 });
  }

  async get<T>(key: string): Promise<CacheHit<T> | undefined> {
    await this.ensure();
    const rows = await db.select().from(reviewCacheEntries).where(eq(reviewCacheEntries.cacheKey, key)).limit(1);
    const row = rows[0];
    if (!row) return undefined;
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      await db.delete(reviewCacheEntries).where(eq(reviewCacheEntries.cacheKey, key)).catch(() => undefined);
      return undefined;
    }
    await db
      .update(reviewCacheEntries)
      .set({ hits: sql`${reviewCacheEntries.hits} + 1`, updatedAt: new Date() })
      .where(eq(reviewCacheEntries.cacheKey, key))
      .catch(() => undefined);
    const kindStats = this.kindStats(row.kind);
    kindStats.hits += 1;
    this.counters.hits += 1;
    return {
      value: row.payload as T,
      key,
      createdAt: row.createdAt.getTime(),
      hits: row.hits + 1,
      meta: (row.meta ?? {}) as Record<string, unknown>,
    };
  }

  async set<T>(input: CacheSetInput<T>): Promise<void> {
    await this.ensure();
    const expiresAt = input.ttlMs !== undefined ? new Date(Date.now() + input.ttlMs) : null;
    await db
      .insert(reviewCacheEntries)
      .values({
        cacheKey: input.key,
        kind: input.kind,
        payload: input.value as unknown,
        meta: input.meta ?? {},
        expiresAt,
      })
      .onConflictDoUpdate({
        target: reviewCacheEntries.cacheKey,
        set: { payload: input.value as unknown, meta: input.meta ?? {}, expiresAt, updatedAt: new Date() },
      });
    const kindStats = this.kindStats(input.kind);
    kindStats.writes += 1;
    this.counters.writes += 1;
  }

  async delete(key: string): Promise<void> {
    await this.ensure();
    await db.delete(reviewCacheEntries).where(eq(reviewCacheEntries.cacheKey, key));
  }

  stats(): CacheStatsSnapshot {
    return {
      ...this.counters,
      byKind: Object.fromEntries(Object.entries(this.counters.byKind).map(([kind, value]) => [kind, { ...value }])),
    };
  }

  recordMiss(kind: string): void {
    const kindStats = this.kindStats(kind);
    kindStats.misses += 1;
    this.counters.misses += 1;
  }

  recordSaved(costUsd: number): void {
    this.counters.creditsSavedUsd += costUsd;
  }
}
