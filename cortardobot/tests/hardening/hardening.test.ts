import test, { after } from "node:test";
import { buildHardeningCases } from "./cases";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled: hardening dry tests must never call an AI API");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

for (const hardeningCase of buildHardeningCases()) {
  test(`${hardeningCase.group} :: ${hardeningCase.name}`, async () => {
    await hardeningCase.run();
  });
}
