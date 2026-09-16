import assert from "node:assert/strict";
import { test } from "node:test";
import { extractJson, redactSecrets, stableStringify, withTimeout } from "../../src/v3/util.ts";

test("withTimeout reports timeouts and does not hide late rejections", async () => {
  const fast = await withTimeout(Promise.resolve(5), 50, 0);
  assert.deepEqual(fast, { value: 5, timedOut: false });

  let lateError: unknown;
  const slow = await withTimeout(new Promise<number>((resolve) => setTimeout(() => resolve(7), 30)), 5, 0, (error) => {
    lateError = error;
  });
  assert.deepEqual(slow, { value: 0, timedOut: true });

  const rejecting = new Promise<number>((_, reject) => setTimeout(() => reject(new Error("late boom")), 20));
  const timed = await withTimeout(rejecting, 5, -1, (error) => {
    lateError = error;
  });
  assert.equal(timed.timedOut, true);
  assert.equal(timed.value, -1);
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.match(String((lateError as Error)?.message ?? ""), /late boom/);
});

test("withTimeout propagates rejections that happen before the deadline", async () => {
  await assert.rejects(() => withTimeout(Promise.reject(new Error("fast boom")), 50, 0), /fast boom/);
});

test("stableStringify keeps shared references and only marks real cycles", () => {
  const shared = { a: 1 };
  assert.equal(stableStringify({ x: shared, y: shared }), '{"x":{"a":1},"y":{"a":1}}');
  const cyclic: Record<string, unknown> = { name: "n" };
  cyclic.self = cyclic;
  assert.match(stableStringify(cyclic), /\[circular\]/);
});

test("extractJson tolerates fenced and embedded JSON and fails descriptively", () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('prefix {"a":2} suffix'), { a: 2 });
  assert.throws(() => extractJson("no json here"), /could not extract JSON/);
  assert.throws(() => extractJson("{not: valid}"), /could not extract JSON/);
});

test("redactSecrets removes credentials from logged and persisted text", () => {
  const clone = "git clone https://x-access-token:ghs_abcdefghijklmnopqrstuvwxyz1234@github.com/acme/api.git";
  const redacted = redactSecrets(clone);
  assert.ok(!redacted.includes("ghs_abcdefghijklmnopqrstuvwxyz1234"));
  assert.match(redacted, /x-access-token:\*\*\*@/);
  assert.match(redactSecrets("token sk-abcdefghijklmnopqrstuvwxyz123456"), /sk-\*\*\*/);
  assert.match(redactSecrets("ghp_abcdefghijklmnopqrstuvwxyz1234"), /gh\*_\*\*\*/);
});
