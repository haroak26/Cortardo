import assert from "node:assert/strict";
import { test } from "node:test";
import { findingState, isVerifiedFix, patchHasHunks, runState, summaryFrom } from "../../src/v3/result.ts";
import { candidate, proof } from "./helpers.ts";
import type { Finding, RepairResult, VerificationReport } from "../../src/v3/types.ts";

function repair(overrides: Partial<RepairResult> = {}): RepairResult {
  return {
    candidateId: "c_test01",
    severity: "high",
    exit: "VERIFIED",
    attempts: [],
    finalPatch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,2 @@\n-const x = undefined\n+const x = 1",
    finalEdits: [{ path: "src/a.ts", find: "const x = undefined", replace: "const x = 1" }],
    durationMs: 1,
    toolCalls: 1,
    reason: "fixed",
    ...overrides,
  };
}

function verification(passed = true): VerificationReport {
  return { passed, steps: [{ kind: "reproduction", command: "check", passed, skipped: false, reason: passed ? "passes" : "fails", durationMs: 1 }], durationMs: 1 };
}

test("isVerifiedFix requires a verified repair, passing verification and a real patch", () => {
  const base: Finding = { candidate: candidate(), proof: proof(candidate()), repair: repair(), verification: verification(true) };
  assert.equal(isVerifiedFix(base), true);
  assert.equal(isVerifiedFix({ ...base, repair: repair({ exit: "UNRESOLVED" }) }), false);
  assert.equal(isVerifiedFix({ ...base, verification: verification(false) }), false);
  assert.equal(isVerifiedFix({ ...base, repair: repair({ finalPatch: "--- a/x\n+++ b/x" }) }), false);
  assert.equal(isVerifiedFix({ ...base, repair: undefined }), false);
});

test("findingState maps to the honest contract", () => {
  const c = candidate();
  const verified: Finding = { candidate: c, proof: proof(c), repair: repair(), verification: verification(true) };
  assert.equal(findingState(verified), "VERIFIED_FIX");

  const unresolved: Finding = { candidate: c, proof: proof(c), repair: repair({ exit: "UNRESOLVED" }), verification: verification(false) };
  assert.equal(findingState(unresolved), "UNRESOLVED");

  const unproven: Finding = { candidate: c, proof: proof(c, "disproven"), repair: undefined };
  assert.equal(findingState(unproven), "UNSUPPORTED");
});

test("runState summarises a run", () => {
  const c = candidate();
  const verified: Finding = { candidate: c, proof: proof(c), repair: repair(), verification: verification(true) };
  assert.equal(runState({ status: "completed", findings: [verified], summary: { staticOnly: 0 } as never }), "VERIFIED_FIX");
  assert.equal(runState({ status: "failed", findings: [], summary: { staticOnly: 0 } as never }), "FAILED");
});

test("summaryFrom counts only isVerifiedFix findings", () => {
  const c = candidate();
  const good: Finding = { candidate: c, proof: proof(c), repair: repair(), verification: verification(true) };
  const noPatch: Finding = { candidate: { ...c, id: "c_2" }, proof: proof({ ...c, id: "c_2" }), repair: repair({ finalPatch: "" }), verification: verification(false) };
  const summary = summaryFrom(
    [c, { ...c, id: "c_2" }],
    [],
    [proof(c), proof({ ...c, id: "c_2" })],
    [good.repair!, noPatch.repair!],
    [good, noPatch],
    0,
    1_000,
    { calls: 3, byRole: {}, tokensIn: 1, tokensOut: 1, cachedTokensIn: 0, costUsd: 0.1, modelMs: 1 },
    { hits: 2, misses: 3, writes: 1, byKind: {}, creditsSavedUsd: 0.05 },
  );
  assert.equal(summary.issuesVerified, 1);
  // A VERIFIED repair without a passing verification is not a fix (3.4).
  assert.equal(summary.issuesFixed, 1);
  assert.equal(summary.cacheHits, 2);
  assert.equal(summary.maxAttempts, 0);
});

test("patchHasHunks tolerates bare and header diffs", () => {
  assert.equal(patchHasHunks("@@ -1 +1 @@\n-a\n+b"), true);
  assert.equal(patchHasHunks("--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b"), true);
  assert.equal(patchHasHunks("--- a/x\n+++ b/x"), false);
  assert.equal(patchHasHunks(undefined), false);
});
