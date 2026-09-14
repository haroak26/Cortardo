import assert from "node:assert/strict";
import test from "node:test";
import { assembleResult, buildFindings, formatResultMarkdown } from "../../src/result";
import {
  makeCandidate,
  makeContext,
  makeProof,
  makeRepair,
  makeVerification,
} from "../helpers/factories";
import type { FinalReview } from "../../src/types";

function assembly(overrides: Partial<Parameters<typeof assembleResult>[0]> = {}) {
  const candidates = [
    makeCandidate({ id: "c1", severity: "critical" }),
    makeCandidate({ id: "c2", claim: "Second issue in another module", file: "src/b.ts", evidence: ["src/b.ts:2"] }),
    makeCandidate({ id: "c3", claim: "Third lower value issue", file: "src/c.ts", evidence: ["src/c.ts:3"] }),
  ];
  return {
    runId: "run_test",
    input: { id: "pr-1", title: "Test PR" },
    context: makeContext(),
    candidates,
    decisions: [
      { hypothesisId: "c1", verdict: "PROVE" as const, reason: "", priority: 1 },
      { hypothesisId: "c2", verdict: "STATIC_ONLY" as const, reason: "", priority: 2 },
      { hypothesisId: "c3", verdict: "DISCARD" as const, reason: "", priority: 3 },
    ],
    proofs: [makeProof({ candidateId: "c1" }), makeProof({ candidateId: "c2", status: "likely" })],
    repairs: [makeRepair({ candidateId: "c1" })],
    verifications: { c1: makeVerification({ passed: true }) },
    reviews: [
      {
        candidateId: "c1",
        validity: "valid",
        fixCorrectness: "correct",
        risk: "high",
        approval: "approve",
        confidence: 0.9,
        summary: "Fixed and verified",
      } satisfies FinalReview,
    ],
    events: [],
    timings: { change_intelligence: 5 },
    usage: { calls: 7, callsByRole: { luna: 3, terra: 3, astra: 1 }, tokensIn: 100, tokensOut: 50, credits: 0.6, modelMs: 10 },
    dryRun: true,
    startedAt: 1000,
    endedAt: 61000,
    status: "completed" as const,
    ...overrides,
  };
}

test("assembleResult computes summary counts", () => {
  const result = assembleResult(assembly());
  assert.equal(result.summary.issuesFound, 3);
  assert.equal(result.summary.issuesConfirmed, 1);
  assert.equal(result.summary.issuesFixed, 1);
  assert.equal(result.summary.issuesVerified, 1);
  assert.equal(result.summary.issuesStaticOnly, 1);
  assert.equal(result.summary.issuesDiscarded, 1);
  assert.equal(result.summary.durationMs, 60000);
  assert.deepEqual(result.summary.exitStates, { VERIFIED: 1, UNRESOLVED: 0, UNSAFE: 0, BUDGET_EXHAUSTED: 0 });
});

test("assembleResult attaches repair, verification and review to findings", () => {
  const result = assembleResult(assembly());
  const finding = result.findings.find((item) => item.candidateId === "c1");
  assert.ok(finding);
  assert.equal(finding.repair?.exit, "VERIFIED");
  assert.equal(finding.verification?.passed, true);
  assert.equal(finding.review?.approval, "approve");
});

test("assembleResult only reports confirmed or likely findings", () => {
  const result = assembleResult(assembly());
  assert.deepEqual(
    result.findings.map((finding) => finding.candidateId).sort(),
    ["c1", "c2"],
  );
});

test("buildFindings skips disproven results", () => {
  const findings = buildFindings(
    [makeCandidate({ id: "c1" })],
    [makeProof({ candidateId: "c1", status: "disproven" })],
    [],
    {},
  );
  assert.equal(findings.length, 0);
});

test("markdown includes fixed findings and static-only notes", () => {
  const result = assembleResult(assembly());
  assert.match(result.markdown, /# Cortado Review/);
  assert.match(result.markdown, /\[FIXED\] CRITICAL/);
  assert.match(result.markdown, /Static only \(1\)/);
  assert.match(result.markdown, /Astra: valid \/ fix correct/);
});

test("markdown reports an empty run when nothing is confirmed", () => {
  const result = assembleResult(
    assembly({
      proofs: [makeProof({ candidateId: "c1", status: "disproven" })],
      repairs: [],
      verifications: {},
      reviews: [],
    }),
  );
  assert.match(result.markdown, /No confirmed issues/);
  assert.equal(result.findings.length, 0);
});

test("markdown reports failed runs", () => {
  const result = assembleResult(
    assembly({
      status: "failed",
      error: "boom",
      context: null,
      candidates: [],
      decisions: [],
      proofs: [],
      repairs: [],
      verifications: {},
      reviews: [],
    }),
  );
  assert.match(result.markdown, /Run failed: boom/);
  assert.equal(result.status, "failed");
});

test("formatResultMarkdown is deterministic for identical results", () => {
  const first = assembleResult(assembly());
  const second = assembleResult(assembly());
  assert.equal(first.markdown, second.markdown);
});
