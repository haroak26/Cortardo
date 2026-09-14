import assert from "node:assert/strict";
import test from "node:test";
import { deterministicJudge, enforceJudgePolicy, maxProveFor } from "../../src/stages/judge";
import { DEFAULT_CONFIG, resolveConfig } from "../../src/config";
import { makeCandidate, makeContext } from "../helpers/factories";

const config = resolveConfig({ mode: "dry" });

test("deterministicJudge proves only candidates above the bar within budget", () => {
  const candidates = [
    makeCandidate({ id: "c1", score: 5 }),
    makeCandidate({ id: "c2", score: 4 }),
    makeCandidate({ id: "c3", score: 3 }),
    makeCandidate({ id: "c4", score: 2 }),
  ];
  const decisions = deterministicJudge(candidates, makeContext(), config);
  assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, 3);
  assert.equal(decisions.filter((decision) => decision.verdict === "STATIC_ONLY").length, 1);
});

test("deterministicJudge discards low value candidates", () => {
  const decisions = deterministicJudge(
    [makeCandidate({ id: "c1", severity: "info", confidence: 0.2, score: 0.2 })],
    makeContext(),
    config,
  );
  assert.equal(decisions[0].verdict, "DISCARD");
});

test("deterministicJudge keeps non-provable candidates static only", () => {
  const decisions = deterministicJudge(
    [makeCandidate({ id: "c1", tags: ["regression", "rule:removed-test-coverage"], score: 9 })],
    makeContext(),
    config,
  );
  assert.equal(decisions[0].verdict, "STATIC_ONLY");
});

test("deterministicJudge adds probe commands only when requested", () => {
  const withProbes = deterministicJudge([makeCandidate({ id: "c1" })], makeContext(), config, {
    probeCommands: true,
  });
  assert.equal(withProbes[0].reproductionCommand, "cortado-probe c1");
  const without = deterministicJudge([makeCandidate({ id: "c1" })], makeContext(), config, {
    probeCommands: false,
  });
  assert.equal(without[0].reproductionCommand, undefined);
});

test("maxProveFor allows more proofs on complex PRs", () => {
  assert.equal(maxProveFor(makeContext({ size: "tiny" }), config), DEFAULT_CONFIG.judge.maxToProve);
  assert.equal(maxProveFor(makeContext({ size: "complex" }), config), DEFAULT_CONFIG.judge.maxToProveComplex);
});

test("enforceJudgePolicy drops unknown ids and fills missing candidates", () => {
  const candidates = [makeCandidate({ id: "c1" }), makeCandidate({ id: "c2" })];
  const decisions = enforceJudgePolicy(
    [{ hypothesisId: "unknown", verdict: "PROVE", reason: "bad", priority: 1 }],
    candidates,
    makeContext(),
    config,
    false,
  );
  assert.equal(decisions.length, 2);
  assert.ok(decisions.every((decision) => decision.hypothesisId !== "unknown"));
});

test("enforceJudgePolicy downgrades excess proofs beyond the budget", () => {
  const candidates = Array.from({ length: 6 }, (_, index) =>
    makeCandidate({ id: `c${index}`, score: 10 - index, confidence: 0.9 }),
  );
  const decisions = enforceJudgePolicy(
    candidates.map((candidate, index) => ({
      hypothesisId: candidate.id,
      verdict: "PROVE" as const,
      reason: "model says prove",
      priority: index + 1,
    })),
    candidates,
    makeContext({ size: "tiny" }),
    config,
    false,
  );
  assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, DEFAULT_CONFIG.judge.maxToProve);
  assert.equal(decisions.filter((decision) => decision.verdict === "STATIC_ONLY").length, 3);
});

test("enforceJudgePolicy downgrades unprovable rules", () => {
  const candidates = [makeCandidate({ id: "c1", tags: ["regression", "rule:removed-test-coverage"] })];
  const decisions = enforceJudgePolicy(
    [{ hypothesisId: "c1", verdict: "PROVE", reason: "prove it", priority: 1 }],
    candidates,
    makeContext(),
    config,
    false,
  );
  assert.equal(decisions[0].verdict, "STATIC_ONLY");
  assert.match(decisions[0].reason, /not provable by execution/);
});

test("enforceJudgePolicy keeps priorities unique for proofs", () => {
  const candidates = [
    makeCandidate({ id: "c1" }),
    makeCandidate({ id: "c2", claim: "Second defect in another module", file: "src/b.ts", evidence: ["src/b.ts:2"] }),
  ];
  const decisions = enforceJudgePolicy(
    [
      { hypothesisId: "c1", verdict: "PROVE", reason: "a", priority: 5 },
      { hypothesisId: "c2", verdict: "PROVE", reason: "b", priority: 5 },
    ],
    candidates,
    makeContext(),
    config,
    false,
  );
  const priorities = decisions.filter((decision) => decision.verdict === "PROVE").map((decision) => decision.priority);
  assert.equal(new Set(priorities).size, priorities.length);
});
