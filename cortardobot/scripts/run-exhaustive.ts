import { EXHAUSTIVE_TARGET, buildExhaustiveCases } from "../tests/exhaustive/cases";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled: exhaustive dry runs must never call an AI API");
}) as typeof fetch;

const cases = buildExhaustiveCases();
if (cases.length !== EXHAUSTIVE_TARGET) {
  process.stderr.write(`Expected ${EXHAUSTIVE_TARGET} exhaustive cases, found ${cases.length}\n`);
  process.exit(1);
}

const started = Date.now();
const failures: Array<{ name: string; error: string }> = [];
const groupTotals = new Map<string, { passed: number; failed: number }>();
let passed = 0;

process.stdout.write(`Cortado exhaustive dry run: ${cases.length} cases (no AI API calls, no network)\n`);

for (let index = 0; index < cases.length; index++) {
  const exhaustiveCase = cases[index];
  const totals = groupTotals.get(exhaustiveCase.group) ?? { passed: 0, failed: 0 };
  try {
    await exhaustiveCase.run();
    passed++;
    totals.passed++;
    process.stdout.write(
      `  [${String(index + 1).padStart(3)}/${cases.length}] PASS ${exhaustiveCase.group} :: ${exhaustiveCase.name}\n`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failures.push({ name: `${exhaustiveCase.group} :: ${exhaustiveCase.name}`, error: message });
    totals.failed++;
    process.stdout.write(
      `  [${String(index + 1).padStart(3)}/${cases.length}] FAIL ${exhaustiveCase.group} :: ${exhaustiveCase.name} — ${message}\n`,
    );
  }
  groupTotals.set(exhaustiveCase.group, totals);
}

globalThis.fetch = originalFetch;

const durationMs = Date.now() - started;
process.stdout.write(`\nGroup summary:\n`);
for (const [group, totals] of [...groupTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  process.stdout.write(`  ${group.padEnd(10)} ${totals.passed} passed, ${totals.failed} failed\n`);
}
process.stdout.write(`\nResult: ${passed}/${cases.length} passed in ${(durationMs / 1000).toFixed(2)}s\n`);

if (failures.length > 0) {
  process.stdout.write(`\nFailures:\n`);
  for (const failure of failures) {
    process.stdout.write(`  - ${failure.name}: ${failure.error}\n`);
  }
  process.exitCode = 1;
}
