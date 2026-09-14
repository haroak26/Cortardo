import { buildDryCases, runDryCase } from "../tests/dry/cases";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled: dry runs must never call an AI API");
}) as typeof fetch;

const cases = buildDryCases();
const started = Date.now();
const failures: Array<{ name: string; error: string }> = [];
let passed = 0;

process.stdout.write(`Cortado dry test run: ${cases.length} cases (no AI API calls)\n`);

for (let index = 0; index < cases.length; index++) {
  const dryCase = cases[index];
  try {
    await runDryCase(dryCase);
    passed++;
    process.stdout.write(`  [${String(index + 1).padStart(3)}/${cases.length}] PASS ${dryCase.name}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name: dryCase.name, error: message });
    process.stdout.write(`  [${String(index + 1).padStart(3)}/${cases.length}] FAIL ${dryCase.name} — ${message}\n`);
  }
}

globalThis.fetch = originalFetch;

const durationMs = Date.now() - started;
process.stdout.write(
  `\nResult: ${passed}/${cases.length} passed in ${(durationMs / 1000).toFixed(2)}s\n`,
);

if (failures.length > 0) {
  process.stdout.write(`\nFailures:\n`);
  for (const failure of failures) {
    process.stdout.write(`  - ${failure.name}: ${failure.error}\n`);
  }
  process.exitCode = 1;
}
