import assert from "node:assert/strict";
import { test } from "node:test";
import { verifyRepairs, relatedTestsFor } from "../../src/v3/verify.ts";
import { candidate, contextWith, packFor, proof, silentLogger } from "./helpers.ts";
import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import type { ProofStatus, RepairResult } from "../../src/v3/types.ts";

function depsFor(status: ProofStatus, opts: { testExit?: number; typecheckExit?: number; probeExit?: number } = {}) {
  const c = candidate();
  const context = contextWith([{ path: "src/a.ts", content: "const x = undefined" }], { tests: ["src/a.test.ts"] });
  const sandbox = new MemorySandbox({
    files: { "src/a.ts": "const x = 1", "src/a.test.ts": "test" },
    profile: { testCommand: "npm test", testSingle: (file: string) => `npx vitest run ${file}`, typecheckCommand: "npx tsc --noEmit" },
    execHandler: (command) => ({
      exitCode: command.includes("repro.test.ts")
        ? (opts.probeExit ?? 0)
        : command.includes("tsc")
          ? (opts.typecheckExit ?? 0)
          : (opts.testExit ?? 0),
      stdout: "ok",
    }),
  });
  return {
    context,
    deps: {
      sandbox,
      profile: { packageManager: "npm" as const, installCommand: "npm ci", hasNodeModules: true, hasTests: true, testCommand: "npm test", testSingle: (file: string) => `npx vitest run ${file}`, typecheckCommand: "npx tsc --noEmit", scripts: {} },
      proveOne: async () => ({ ...proof(c, status), explanation: `proof status ${status}` }),
      baselineTypecheckPassed: true,
      logger: silentLogger,
    },
  };
}

const repairFor = (candidateId = "c_test01", probe?: RepairResult["probe"]) => ({
  candidateId,
  severity: "high" as const,
  exit: "VERIFIED" as const,
  attempts: [],
  finalPatch: "@@ -1,2 +1,1 @@\n-const x = undefined\n+const x = 1",
  finalEdits: [{ path: "src/a.ts", find: "const x = undefined", replace: "const x = 1" }],
  ...(probe ? { probe } : {}),
  durationMs: 1,
  toolCalls: 1,
  reason: "fixed",
});

const promotedProbe = {
  name: "repro.test.ts",
  content: "test('repro', () => { throw new Error('boom') })",
  command: "npx vitest run .cortado-probes/repro.test.ts",
  passed: false,
  output: "boom",
};

test("a promoted authored probe is re-run after the fix and must pass", async () => {
  const { context, deps } = depsFor("disproven", { probeExit: 0 });
  const reports = await verifyRepairs([repairFor("c_test01", promotedProbe)], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, true);
  const step = reports.c_test01.steps.find((entry) => entry.kind === "authored_probe");
  assert.equal(step?.skipped, false);
  assert.equal(step?.passed, true);
  assert.match(step?.reason ?? "", /model-authored probe/);
});

test("a promoted authored probe that fails after the fix fails verification", async () => {
  const { context, deps } = depsFor("disproven", { probeExit: 1 });
  const reports = await verifyRepairs([repairFor("c_test01", promotedProbe)], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, false);
  const step = reports.c_test01.steps.find((entry) => entry.kind === "authored_probe");
  assert.equal(step?.passed, false);
});

test("repairs without a probe have no authored_probe step", async () => {
  const { context, deps } = depsFor("disproven");
  const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
  assert.equal(reports.c_test01.steps.some((entry) => entry.kind === "authored_probe"), false);
});

test("verification passes only when the reproduction is disproven and steps pass", async () => {
  const { context, deps } = depsFor("disproven");
  const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, true);
  assert.equal(reports.c_test01.steps.find((step) => step.kind === "reproduction")?.passed, true);
});

test("a still-confirmed defect can never be reported as verified", async () => {
  const { context, deps } = depsFor("confirmed");
  const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, false);
  assert.match(reports.c_test01.steps[0].reason, /still reproduces/);
});

test("a likely/error proof is inconclusive, not a pass", async () => {
  for (const status of ["likely", "error"] as const) {
    const { context, deps } = depsFor(status);
    const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
    assert.equal(reports.c_test01.passed, false, `${status} must not verify`);
    assert.match(reports.c_test01.steps[0].reason, /inconclusive/);
  }
});

test("a verified repair without patch hunks fails verification", async () => {
  const { context, deps } = depsFor("disproven");
  const reports = await verifyRepairs([{ ...repairFor(), finalPatch: "--- a/src/a.ts\n+++ b/src/a.ts" }], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, false);
  assert.match(reports.c_test01.steps[0].reason, /no patch hunks/);
});

test("failing touched-file tests fail verification even when the reproduction passes", async () => {
  const { context, deps } = depsFor("disproven", { testExit: 1 });
  const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, false);
  assert.equal(reports.c_test01.steps.find((step) => step.kind === "targeted_tests")?.passed, false);
});

test("batch proof and typecheck run once and are shared across repairs", async () => {
  const c1 = candidate({ id: "c_batch1", file: "src/a.ts" });
  const c2 = candidate({ id: "c_batch2", file: "src/b.ts" });
  const context = contextWith(
    [
      { path: "src/a.ts", content: "x" },
      { path: "src/b.ts", content: "y" },
    ],
    { tests: [] },
  );
  const batchCalls: string[][] = [];
  let execCount = 0;
  const sandbox = new MemorySandbox({
    files: { "src/a.ts": "x", "src/b.ts": "y" },
    profile: { typecheckCommand: "npx tsc --noEmit" },
    execHandler: () => {
      execCount += 1;
      return { exitCode: 0, stdout: "ok" };
    },
  });
  const reports = await verifyRepairs([repairFor("c_batch1"), repairFor("c_batch2")], [c1, c2], context, {
    sandbox,
    profile: { packageManager: "npm", installCommand: "npm ci", hasNodeModules: true, hasTests: false, typecheckCommand: "npx tsc --noEmit", scripts: {} },
    proveOne: async () => {
      throw new Error("proveOne must not be called when proveMany is provided");
    },
    proveMany: async (list) => {
      batchCalls.push(list.map((entry) => entry.id));
      return list.map((entry) => proof(entry, "disproven"));
    },
    baselineTypecheckPassed: true,
    logger: silentLogger,
  });
  assert.deepEqual(batchCalls, [["c_batch1", "c_batch2"]]);
  assert.equal(execCount, 1, "typecheck runs once for the whole run");
  assert.equal(reports.c_batch1.passed, true);
  assert.equal(reports.c_batch2.passed, true);
  assert.equal(reports.c_batch1.steps.filter((step) => step.kind === "typecheck").length, 1);
  assert.equal(reports.c_batch2.steps.filter((step) => step.kind === "typecheck").length, 1);
});

function affectedDeps(opts: { affectedExit: number; baseline?: { passed: boolean; output: string }; testExit?: number }) {
  const c = candidate();
  const context = contextWith([{ path: "src/a.ts", content: "const x = undefined" }], { tests: ["src/a.test.ts"] });
  const sandbox = new MemorySandbox({
    files: { "src/a.ts": "const x = 1", "src/a.test.ts": "test" },
    profile: { testCommand: "npm test", testSingle: (file: string) => `npx vitest run ${file}`, typecheckCommand: "npx tsc --noEmit" },
    execHandler: (command) => ({
      exitCode: command === "npm test" ? opts.affectedExit : command.includes("tsc") ? 0 : (opts.testExit ?? 0),
      stdout: "ok",
    }),
  });
  return {
    context,
    deps: {
      sandbox,
      profile: { packageManager: "npm" as const, installCommand: "npm ci", hasNodeModules: true, hasTests: true, testCommand: "npm test", testSingle: (file: string) => `npx vitest run ${file}`, typecheckCommand: "npx tsc --noEmit", scripts: {} },
      proveOne: async () => ({ ...proof(c, "disproven" as const), explanation: "proof disproven" }),
      baselineTypecheckPassed: true,
      baselineTests: opts.baseline,
      logger: silentLogger,
    },
  };
}

test("affected tests fail verification when the full suite regresses", async () => {
  const { context, deps } = affectedDeps({ affectedExit: 1, baseline: { passed: true, output: "green" } });
  const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, false);
  const step = reports.c_test01.steps.find((entry) => entry.kind === "affected_tests");
  assert.equal(step?.skipped, false);
  assert.equal(step?.passed, false);
});

test("a pre-existing failing baseline cannot block verification", async () => {
  const { context, deps } = affectedDeps({ affectedExit: 1, baseline: { passed: false, output: "already failing" } });
  const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, true);
  const step = reports.c_test01.steps.find((entry) => entry.kind === "affected_tests");
  assert.equal(step?.skipped, true);
  assert.match(step?.reason ?? "", /baseline test suite already failing/);
});

test("without a baseline run the affected-tests step is skipped honestly", async () => {
  const { context, deps } = affectedDeps({ affectedExit: 1 });
  const reports = await verifyRepairs([repairFor()], [candidate()], context, deps);
  assert.equal(reports.c_test01.passed, true);
  const step = reports.c_test01.steps.find((entry) => entry.kind === "affected_tests");
  assert.equal(step?.skipped, true);
  assert.match(step?.reason ?? "", /no baseline test run/);
});

test("test discovery does not match substrings", () => {
  const c = candidate({ file: "src/a.ts" });
  const context = contextWith([{ path: "src/a.ts", content: "x" }], { tests: ["src/data.test.ts", "src/a.test.ts", "src/a-extra.spec.ts"] });
  assert.deepEqual(relatedTestsFor(c, context), ["src/a.test.ts", "src/a-extra.spec.ts"]);
});
