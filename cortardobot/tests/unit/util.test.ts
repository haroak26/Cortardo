import assert from "node:assert/strict";
import test from "node:test";
import { fnv1a, shortHash, stableId } from "../../src/util/hash";
import {
  claimKey,
  clamp,
  countBy,
  estimateTokens,
  formatMs,
  normalizePath,
  normalizeWhitespace,
  relativePath,
  truncate,
  truncateMiddle,
  unique,
} from "../../src/util/text";
import { extractJson, safeJsonParse } from "../../src/util/json";
import { mapLimit, retry, withTimeout, TimeoutError } from "../../src/util/async";
import { createDeadline, SimulatedClock } from "../../src/util/clock";
import { createLogger } from "../../src/util/logger";

test("fnv1a is deterministic and 8 hex chars", () => {
  assert.equal(fnv1a("hello"), fnv1a("hello"));
  assert.match(fnv1a("hello"), /^[0-9a-f]{8}$/);
});

test("shortHash respects the requested length", () => {
  assert.equal(shortHash("hello", 4).length, 4);
  assert.equal(shortHash("hello", 16).length, 16);
  assert.notEqual(shortHash("a", 16), shortHash("b", 16));
});

test("stableId is stable across calls", () => {
  assert.equal(stableId("h", "pr", "claim"), stableId("h", "pr", "claim"));
  assert.notEqual(stableId("h", "pr", "a"), stableId("h", "pr", "b"));
});

test("text helpers behave", () => {
  assert.equal(truncate("hello world", 5), "hell…");
  assert.equal(truncate("hi", 5), "hi");
  assert.equal(truncateMiddle("abcdefghij", 7), "abc…hij");
  assert.equal(normalizeWhitespace(" a  b \n c "), "a b c");
  assert.equal(normalizePath("./src\\app.ts"), "src/app.ts");
  assert.equal(relativePath("src/lib/a.ts", "src/lib/b.ts"), "./b.ts");
  assert.equal(relativePath("src/lib/a.ts", "src/other/b.ts"), "../other/b.ts");
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(Number.NaN, 2, 3), 2);
  assert.equal(formatMs(500), "500ms");
  assert.equal(formatMs(1500), "1.5s");
  assert.deepEqual(unique([1, 1, 2]), [1, 2]);
  assert.deepEqual(countBy(["a", "b", "a"], (item) => item), { a: 2, b: 1 });
});

test("claimKey normalizes claim text for dedupe", () => {
  assert.equal(
    claimKey("The SQL statement is assembled with interpolation"),
    claimKey("sql statement assembled with interpolation"),
  );
  assert.notEqual(claimKey("SQL injection risk"), claimKey("XSS risk"));
});

test("extractJson parses plain, fenced and nested JSON", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('prefix {"a":{"b":3}} suffix'), { a: { b: 3 } });
  assert.deepEqual(extractJson('[{"a":1}]'), [{ a: 1 }]);
});

test("extractJson handles braces inside strings", () => {
  assert.deepEqual(extractJson('{"text":"a } b { c","n":1}'), { text: "a } b { c", n: 1 });
});

test("extractJson throws for unparseable input", () => {
  assert.throws(() => extractJson("no json here"), /could not parse JSON/);
  assert.throws(() => extractJson(""), /empty model response/);
});

test("safeJsonParse returns the fallback on failure", () => {
  assert.deepEqual(safeJsonParse('{"a":1}', { fallback: true }), { a: 1 });
  assert.deepEqual(safeJsonParse("nope", { fallback: true }), { fallback: true });
});

test("mapLimit preserves ordering and respects the limit", async () => {
  let active = 0;
  let maxActive = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (value) => {
    active++;
    maxActive = Math.max(maxActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active--;
    return value * 2;
  });
  assert.deepEqual(results, [2, 4, 6, 8, 10, 12]);
  assert.ok(maxActive <= 2, `max active ${maxActive}`);
});

test("mapLimit handles an empty input", async () => {
  assert.deepEqual(await mapLimit([], 3, async () => 1), []);
});

test("withTimeout resolves fast promises and rejects slow ones", async () => {
  assert.equal(await withTimeout(Promise.resolve(1), 50), 1);
  await assert.rejects(() => withTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 5), TimeoutError);
  assert.equal(await withTimeout(new Promise((resolve) => setTimeout(resolve, 50)), 5, () => 42), 42);
});

test("retry retries failures and returns the eventual success", async () => {
  let attempts = 0;
  const value = await retry(
    async () => {
      attempts++;
      if (attempts < 3) throw new Error("flaky");
      return "ok";
    },
    { retries: 3, delayMs: 1 },
  );
  assert.equal(value, "ok");
  assert.equal(attempts, 3);
});

test("retry surfaces the final error", async () => {
  await assert.rejects(
    () => retry(async () => { throw new Error("always"); }, { retries: 1, delayMs: 1 }),
    /always/,
  );
});

test("SimulatedClock advances on demand and on sleep", async () => {
  const clock = new SimulatedClock(1000, 0);
  assert.equal(clock.now(), 1000);
  clock.advance(500);
  assert.equal(clock.now(), 1500);
  await clock.sleep(250);
  assert.equal(clock.now(), 1750);
});

test("SimulatedClock can auto advance per now() call", () => {
  const clock = new SimulatedClock(0, 10);
  assert.equal(clock.now(), 0);
  assert.equal(clock.now(), 10);
});

test("createDeadline reports remaining and expiry", () => {
  const clock = new SimulatedClock(0, 0);
  const deadline = createDeadline(100, clock);
  assert.equal(deadline.expired(), false);
  clock.advance(60);
  assert.equal(deadline.remainingMs(), 40);
  clock.advance(50);
  assert.equal(deadline.expired(), true);
});

test("logger respects levels and scopes", () => {
  const lines: string[] = [];
  const logger = createLogger({ level: "warn", scope: "unit", sink: (line) => lines.push(line) });
  logger.debug("hidden");
  logger.info("hidden too");
  logger.warn("visible", { a: 1 });
  logger.error("also visible");
  logger.child("child").warn("nested");
  assert.equal(lines.length, 3);
  assert.match(lines[0], /\[cortado:unit\] warn visible \{"a":1\}/);
  assert.match(lines[2], /\[cortado:unit:child\] warn nested/);
});

test("silent logger emits nothing", () => {
  const lines: string[] = [];
  const logger = createLogger({ level: "silent", sink: (line) => lines.push(line) });
  logger.error("nothing");
  assert.equal(lines.length, 0);
});
