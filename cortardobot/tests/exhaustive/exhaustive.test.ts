import assert from "node:assert/strict";
import test, { after } from "node:test";
import { EXHAUSTIVE_TARGET, buildExhaustiveCases } from "./cases";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled: exhaustive dry tests must never call an AI API");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

const cases = buildExhaustiveCases();

test(`exhaustive suite is exactly ${EXHAUSTIVE_TARGET} cases`, () => {
  assert.equal(cases.length, EXHAUSTIVE_TARGET);
});

for (const exhaustiveCase of cases) {
  test(`${exhaustiveCase.group} :: ${exhaustiveCase.name}`, async () => {
    await exhaustiveCase.run();
  });
}
