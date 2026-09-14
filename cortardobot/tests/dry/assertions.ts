import assert from "node:assert/strict";
import type { PrFixture } from "../../fixtures/prs";
import type { RepairBehavior } from "../../src/models/dry";
import type { ProofBehavior } from "./scenario";
import type { CortadoResult } from "../../src/types";

export interface AssertContext {
  fixture: PrFixture;
  proof: ProofBehavior;
  repair: RepairBehavior;
  detectedRules: Set<string>;
}

export function hasSupportTests(fixture: PrFixture): boolean {
  return Object.keys(fixture.supportFiles).some((path) => /\.(test|spec)\./.test(path));
}

export function assertScenarioResult(result: CortadoResult, context: AssertContext): void {
  const { fixture, proof, repair } = context;

  assert.equal(result.status, "completed", result.error ?? "pipeline failed");
  assert.equal(result.dryRun, true, "dry matrix must never run live models");
  assert.ok(result.context, "change intelligence must produce a context");
  assert.equal(result.context.size, fixture.expected.size);
  for (const category of fixture.expected.classificationIncludes) {
    assert.ok(
      result.pr.classification.includes(category),
      `expected classification ${category} in ${result.pr.classification.join(",")}`,
    );
  }

  for (const rule of fixture.expected.ruleIds) {
    assert.ok(context.detectedRules.has(rule), `detector ${rule} did not fire for ${fixture.id}`);
  }

  assert.ok(
    result.candidates.length >= fixture.expected.minCandidates,
    `expected at least ${fixture.expected.minCandidates} candidates, got ${result.candidates.length}`,
  );
  assert.equal(result.decisions.length, result.candidates.length);
  const decisionIds = new Set(result.decisions.map((decision) => decision.hypothesisId));
  assert.equal(decisionIds.size, result.decisions.length, "decisions must be unique");
  for (const candidate of result.candidates) assert.ok(decisionIds.has(candidate.id));

  const proved = new Set(
    result.decisions
      .filter((decision) => decision.verdict === "PROVE")
      .map((decision) => decision.hypothesisId),
  );
  for (const proofResult of result.proofs) {
    assert.ok(proved.has(proofResult.candidateId), "only PROVE candidates may be executed");
  }
  assert.ok(result.proofs.length <= proved.size);

  const confirmed = new Set(
    result.proofs.filter((proofResult) => proofResult.status === "confirmed").map((item) => item.candidateId),
  );
  assert.equal(result.repairs.length, confirmed.size, "every confirmed finding must enter repair");
  for (const repairResult of result.repairs) {
    assert.ok(confirmed.has(repairResult.candidateId));
    assert.ok(repairResult.attempts.length <= 3, "repair attempts must respect the budget");
    assert.ok(repairResult.toolCalls <= 12, "repair tool calls must respect the budget");
  }

  for (const finding of result.findings) {
    assert.ok(["confirmed", "likely"].includes(finding.proof.status));
  }
  assert.equal(result.reviews.length, result.findings.length);
  assert.ok(result.usage.calls > 0, "dry models must still record usage");

  for (const stage of [
    "change_intelligence",
    "sandbox_setup",
    "swarm",
    "evidence_merge",
    "judge",
    "findings",
    "final_review",
    "assemble",
  ] as const) {
    assert.notEqual(result.timings[stage], undefined, `missing timing for ${stage}`);
  }
  assert.ok(result.events.some((event) => event.stage === "change_intelligence" && event.status === "completed"));

  if (proof === "confirm") {
    assert.ok(confirmed.size >= 1, "confirm behavior must reproduce at least one finding");
  } else if (proof === "no-repro") {
    assert.equal(confirmed.size, 0);
    assert.ok(result.proofs.every((item) => item.status === "disproven"));
  } else if (proof === "timeout" || proof === "missing-deps") {
    assert.equal(confirmed.size, 0);
    assert.ok(result.proofs.every((item) => item.status === "error"));
  } else if (proof === "flaky") {
    if (hasSupportTests(fixture)) {
      assert.ok(confirmed.size >= 1, "flaky behavior eventually reproduces");
    } else {
      assert.equal(confirmed.size, 0);
    }
  }

  if (proof === "confirm" || (proof === "flaky" && hasSupportTests(fixture))) {
    if (repair === "fix" || repair === "wrong-layer") {
      assert.ok(result.repairs.length >= 1);
      for (const repairResult of result.repairs) {
        assert.equal(repairResult.exit, "VERIFIED", repairResult.reason);
        if (repair === "wrong-layer") {
          assert.ok(repairResult.attempts.length >= 2, "wrong-layer behavior must require a diagnosed second attempt");
        }
        const finding = result.findings.find((item) => item.candidateId === repairResult.candidateId);
        assert.equal(finding?.verification?.passed, true);
      }
    } else if (repair === "always-fail") {
      assert.ok(result.repairs.length >= 1);
      for (const repairResult of result.repairs) {
        assert.equal(repairResult.exit, "UNRESOLVED", repairResult.reason);
        assert.equal(repairResult.attempts.length, 3);
      }
    } else if (repair === "unsafe") {
      assert.ok(result.repairs.length >= 1);
      for (const repairResult of result.repairs) {
        assert.equal(repairResult.exit, "UNSAFE", repairResult.reason);
      }
    } else if (repair === "timeout") {
      assert.ok(result.repairs.length >= 1);
      for (const repairResult of result.repairs) {
        assert.equal(repairResult.exit, "BUDGET_EXHAUSTED", repairResult.reason);
      }
    }
  } else {
    assert.equal(result.repairs.length, 0);
  }
}
