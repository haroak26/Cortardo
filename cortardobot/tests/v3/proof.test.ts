import assert from "node:assert/strict";
import { test } from "node:test";
import { proveOne } from "../../src/v3/proof.ts";
import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import { browserCheck, candidate, checkResult, silentLogger } from "./helpers.ts";
import type { BrowserCheck, BrowserCheckResult } from "../../src/v3/types.ts";

function deps(handler: (checks: Array<{ id: string; check: BrowserCheck }>) => BrowserCheckResult[]) {
  const sandbox = new MemorySandbox({
    files: {},
    browserHandler: handler,
    execHandler: () => ({ exitCode: 0, stdout: "" }),
  });
  return { sandbox, profile: { packageManager: "npm" as const, installCommand: "npm ci", hasNodeModules: true, hasTests: false, scripts: {} }, logger: silentLogger };
}

test("a single passing check is confirmed by a second run before a defect is dismissed", async () => {
  let calls = 0;
  const value = candidate({ check: browserCheck("/pricing", "Most Popular") });
  const proof = await proveOne(value, deps((checks) => {
    calls += 1;
    return checks.map((entry) => checkResult(entry.id, entry.check.path, true));
  }));
  assert.equal(proof.status, "disproven");
  assert.equal(calls, 2, "passing checks must be re-run for confirmation");
});

test("a flaky pass that fails on the confirmation run is still a reproduced defect", async () => {
  let calls = 0;
  const value = candidate({ check: browserCheck("/pricing", "Most Popular") });
  const proof = await proveOne(value, deps((checks) => {
    calls += 1;
    return checks.map((entry) => checkResult(entry.id, entry.check.path, calls === 1, calls === 1 ? "assertion passed" : "assertion failed"));
  }));
  assert.equal(proof.status, "confirmed");
  assert.equal(calls, 2);
});

test("a harness failure is an error, never a confirmed defect", async () => {
  const value = candidate({ check: browserCheck("/docs", "Docs") });
  const proof = await proveOne(value, deps((checks) => checks.map((entry) => ({ ...checkResult(entry.id, entry.check.path, false, "harness error: click timed out"), harnessError: true }))));
  assert.equal(proof.status, "error");
  assert.match(proof.explanation, /could not run/);
});

test("browser scripts without a check have no executable proof", async () => {
  const value = candidate({ check: undefined, suggestedProof: "none" });
  const proof = await proveOne(value, deps(() => []));
  assert.equal(proof.status, "error");
});
