import { HARDENING_TARGET, buildHardeningCases } from "../tests/hardening/cases";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled: hardening dry runs must never call an AI API");
}) as typeof fetch;

const cases = buildHardeningCases();
if (cases.length !== HARDENING_TARGET) {
  process.stderr.write(`Expected ${HARDENING_TARGET} hardening cases, found ${cases.length}\n`);
  process.exit(1);
}

const started = Date.now();
let passed = 0;
const failures: Array<{ name: string; error: string }> = [];

process.stdout.write(`Cortado hardening dry run: ${cases.length} cases (no AI API calls, no network)\n`);

for (let index = 0; index < cases.length; index++) {
  const hardeningCase = cases[index];
  try {
    await hardeningCase.run();
    passed++;
    process.stdout.write(
      `  [${String(index + 1).padStart(2)}/${cases.length}] PASS ${hardeningCase.name}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name: hardeningCase.name, error: message });
    process.stdout.write(
      `  [${String(index + 1).padStart(2)}/${cases.length}] FAIL ${hardeningCase.name} — ${message}\n`,
    );
  }
}

globalThis.fetch = originalFetch;

process.stdout.write(
  `\nResult: ${passed}/${cases.length} passed in ${((Date.now() - started) / 1000).toFixed(2)}s\n`,
);

if (failures.length > 0) {
  process.stdout.write(`\nFailures:\n`);
  for (const failure of failures) {
    process.stdout.write(`  - ${failure.name}: ${failure.error}\n`);
  }
  process.exitCode = 1;
}
