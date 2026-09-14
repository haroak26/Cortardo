import test, { after } from "node:test";
import { buildDryCases, runDryCase } from "./cases";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled: dry tests must never call an AI API");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

for (const dryCase of buildDryCases()) {
  test(`dry matrix: ${dryCase.name}`, async () => {
    await runDryCase(dryCase);
  });
}
