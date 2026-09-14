import test, { after } from "node:test";
import { buildFinalCases } from "./cases";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled: final dry tests must never call an AI API");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

for (const finalCase of buildFinalCases()) {
  test(`${finalCase.group} :: ${finalCase.name}`, async () => {
    await finalCase.run();
  });
}
