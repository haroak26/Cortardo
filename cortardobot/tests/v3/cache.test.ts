import assert from "node:assert/strict";
import { test } from "node:test";
import { MemoryCacheStore } from "../../src/v3/cache/memory-store.ts";
import { cacheKey } from "../../src/v3/cache/keys.ts";

test("cache keys are deterministic and sensitive to versions and content", () => {
  const a = cacheKey("repair", { repo: "o/r", headSha: "abc", model: "m", fileHashes: { "a.ts": "h1" } });
  const b = cacheKey("repair", { repo: "o/r", headSha: "abc", model: "m", fileHashes: { "a.ts": "h1" } });
  const c = cacheKey("repair", { repo: "o/r", headSha: "abc", model: "m", fileHashes: { "a.ts": "h2" } });
  const d = cacheKey("repair", { repo: "o/r", headSha: "abc", model: "other", fileHashes: { "a.ts": "h1" } });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.notEqual(cacheKey("swarm", { repo: "o/r" }), cacheKey("judge", { repo: "o/r" }));
});

test("memory cache stores, hits, expires and counts", async () => {
  const cache = new MemoryCacheStore({ maxEntries: 10 });
  await cache.set({ key: "k1", kind: "repair", value: { patch: "x" }, ttlMs: 5_000, meta: { costUsd: 0.02 } });
  const hit = await cache.get<{ patch: string }>("k1");
  assert.equal(hit?.value.patch, "x");
  assert.equal(hit?.meta?.costUsd, 0.02);
  assert.equal(cache.stats().hits, 1);
  assert.equal(cache.stats().creditsSavedUsd, 0);

  cache.recordSaved(0.02);
  assert.equal(cache.stats().creditsSavedUsd, 0.02);

  await cache.set({ key: "k2", kind: "swarm", value: 1, ttlMs: -1 });
  assert.equal(await cache.get("k2"), undefined);

  cache.recordMiss("swarm");
  assert.equal(cache.stats().misses, 1);
  assert.equal(cache.stats().byKind.swarm?.misses, 1);
});

test("memory cache evicts least-recently-used entries", async () => {
  const cache = new MemoryCacheStore({ maxEntries: 2 });
  await cache.set({ key: "a", kind: "memo", value: 1 });
  await cache.set({ key: "b", kind: "memo", value: 2 });
  await cache.get("a");
  await cache.set({ key: "c", kind: "memo", value: 3 });
  assert.ok(await cache.get("a"));
  assert.equal(await cache.get("b"), undefined);
  assert.ok(await cache.get("c"));
});
