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

test("a check redirected away from its target page is a harness error, not a confirmed defect", async () => {
  const value = candidate({ check: browserCheck("/billing", "Active plan") });
  const proof = await proveOne(
    value,
    deps((checks) =>
      checks.map((entry) => ({
        ...checkResult(entry.id, entry.check.path, false, `assertion failed (expected pass) at http://127.0.0.1:4173/auth`),
        landedPath: "/auth",
      })),
    ),
  );
  assert.equal(proof.status, "error", "a failure observed on a redirected page must never confirm the claim");
  assert.match(proof.explanation, /could not run/);
});

test("browser scripts without a check have no executable proof", async () => {
  const value = candidate({ check: undefined, suggestedProof: "none" });
  const proof = await proveOne(value, deps(() => []));
  assert.equal(proof.status, "error");
});

test("a probe artifact is replayed twice and confirmed when it keeps failing", async () => {
  let calls = 0;
  const value = candidate({
    check: undefined,
    suggestedProof: "none",
    artifact: { kind: "probe", path: "repro.test.ts", content: "test('x', () => expect(1).toBe(2))", command: "npx vitest run repro.test.ts", preFixFailures: 2, artifactHash: "h" },
  });
  const sandbox = new MemorySandbox({
    files: {},
    profile: { testSingle: (file: string) => `npx vitest run ${file}` },
    execHandler: () => {
      calls += 1;
      return { exitCode: 1, stdout: "FAIL src/a.ts > x: expected 1 to be 2" };
    },
  });
  const proofResult = await proveOne(value, {
    sandbox,
    profile: { packageManager: "npm", installCommand: "npm ci", hasNodeModules: true, hasTests: true, testSingle: (file: string) => `npx vitest run ${file}`, scripts: {} },
    logger: silentLogger,
  });
  assert.equal(calls, 2, "probe artifacts must fail twice before confirming (flake guard)");
  assert.equal(proofResult.status, "confirmed");
  assert.equal(proofResult.strategy, "probe");
  assert.equal(proofResult.artifact?.preFixFailures, 2);
});

test("a probe artifact that passes twice disproves the claim", async () => {
  let calls = 0;
  const value = candidate({
    check: undefined,
    suggestedProof: "none",
    artifact: { kind: "probe", path: "repro.test.ts", content: "test('x', () => expect(1).toBe(1))", command: "npx vitest run repro.test.ts", preFixFailures: 2, artifactHash: "h" },
  });
  const sandbox = new MemorySandbox({
    files: {},
    profile: { testSingle: (file: string) => `npx vitest run ${file}` },
    execHandler: () => {
      calls += 1;
      return { exitCode: 0, stdout: "PASS" };
    },
  });
  const proofResult = await proveOne(value, {
    sandbox,
    profile: { packageManager: "npm", installCommand: "npm ci", hasNodeModules: true, hasTests: true, testSingle: (file: string) => `npx vitest run ${file}`, scripts: {} },
    logger: silentLogger,
  });
  assert.equal(calls, 1);
  assert.equal(proofResult.status, "disproven");
});
