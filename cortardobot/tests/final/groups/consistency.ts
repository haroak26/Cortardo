import assert from "node:assert/strict";
import { FIXTURES } from "../../../fixtures/prs";
import { runScenario } from "../../dry/run-case";
import { selectAgents } from "../../../src/agents/roster";
import { resolveConfig } from "../../../src/config";
import { defineCases } from "../../exhaustive/types";
import type { ProofBehavior } from "../../dry/scenario";
import type { RepairBehavior } from "../../../src/models/dry";

const PAIRS: Array<[ProofBehavior, RepairBehavior]> = [
  ["confirm", "fix"],
  ["confirm", "wrong-layer"],
  ["no-repro", "fix"],
  ["flaky", "fix"],
  ["timeout", "fix"],
  ["confirm", "always-fail"],
  ["confirm", "unsafe"],
  ["confirm", "timeout"],
  ["missing-deps", "unsafe"],
  ["flaky", "always-fail"],
];

const config = resolveConfig({ mode: "dry" });

export function buildConsistencyGroup() {
  const cases: Array<{ name: string; run: () => Promise<void> }> = [];

  FIXTURES.forEach((fixture, fixtureIndex) => {
    for (let offset = 0; offset < 4; offset++) {
      const [proof, repair] = PAIRS[(fixtureIndex * 4 + offset) % PAIRS.length];
      cases.push({
        name: `consistency ${fixture.id} proof=${proof} repair=${repair}`,
        run: async () => {
          const { result } = await runScenario({ fixture, proof, repair });

          assert.equal(result.status, "completed", result.error);
          assert.equal(result.dryRun, true);
          assert.ok(result.context);
          assert.equal(result.pr.size, fixture.expected.size);
          for (const category of fixture.expected.classificationIncludes) {
            assert.ok(result.pr.classification.includes(category));
          }

          const candidateIds = result.candidates.map((candidate) => candidate.id);
          assert.equal(new Set(candidateIds).size, candidateIds.length, "candidate ids unique");
          assert.ok(
            result.candidates.every((candidate) => candidate.evidence.length > 0),
            "every candidate has evidence",
          );

          assert.equal(result.decisions.length, result.candidates.length);
          const decisionIds = new Set(result.decisions.map((decision) => decision.hypothesisId));
          for (const id of candidateIds) assert.ok(decisionIds.has(id));
          const proved = new Set(
            result.decisions.filter((decision) => decision.verdict === "PROVE").map((decision) => decision.hypothesisId),
          );
          for (const proofResult of result.proofs) assert.ok(proved.has(proofResult.candidateId));
          assert.ok(result.proofs.length <= proved.size);

          const confirmed = new Set(
            result.proofs.filter((proofResult) => proofResult.status === "confirmed").map((item) => item.candidateId),
          );
          assert.equal(result.repairs.length, confirmed.size);
          for (const repairResult of result.repairs) {
            assert.ok(confirmed.has(repairResult.candidateId));
            assert.ok(repairResult.attempts.length <= 3);
            assert.ok(repairResult.toolCalls <= 12);
          }

          for (const finding of result.findings) {
            assert.ok(["confirmed", "likely"].includes(finding.proof.status));
          }
          assert.equal(result.reviews.length, result.findings.length);
          assert.ok(result.usage.calls > 0);
          assert.equal(result.summary.issuesConfirmed, confirmed.size);
          assert.equal(result.summary.issuesFixed, result.repairs.filter((item) => item.exit === "VERIFIED").length);

          for (const stage of ["change_intelligence", "sandbox_setup", "swarm", "evidence_merge", "judge", "findings", "final_review", "assemble"] as const) {
            assert.notEqual(result.timings[stage], undefined, `missing ${stage} timing`);
          }
          assert.ok(result.events.some((event) => event.stage === "change_intelligence" && event.status === "completed"));
          assert.ok(result.markdown.endsWith("\n"));

          const agents = selectAgents(result.context, config);
          const limit = config.swarm[result.context.size];
          assert.ok(agents.length <= limit, `agents ${agents.length} over limit ${limit}`);
        },
      });
    }
  });

  assert.equal(cases.length, 40);
  return defineCases("consistency", cases);
}
