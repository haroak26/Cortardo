import assert from "node:assert/strict";
import { FIXTURES } from "../../../fixtures/prs";
import { runScenario } from "../../dry/run-case";
import { defineCases } from "../../exhaustive/types";
import type { ProofBehavior } from "../../dry/scenario";
import type { RepairBehavior } from "../../../src/models/dry";
import type { CortadoResult } from "../../../src/types";

function stable(result: CortadoResult): string {
  return JSON.stringify({
    markdown: result.markdown,
    summary: result.summary,
    candidates: result.candidates.map((candidate) => candidate.id),
    decisions: result.decisions.map((decision) => [decision.hypothesisId, decision.verdict]),
    proofs: result.proofs.map((proof) => [proof.candidateId, proof.status]),
    repairs: result.repairs.map((repair) => [repair.candidateId, repair.exit, repair.attempts.length]),
    findings: result.findings.map((finding) => [finding.candidateId, finding.proof.status]),
  });
}

async function run(fixtureIndex: number, proof: ProofBehavior, repair: RepairBehavior): Promise<CortadoResult> {
  const { result } = await runScenario({ fixture: FIXTURES[fixtureIndex % FIXTURES.length], proof, repair });
  return result;
}

const PAIRS: Array<[ProofBehavior, RepairBehavior]> = [
  ["confirm", "fix"],
  ["confirm", "wrong-layer"],
  ["flaky", "fix"],
  ["no-repro", "fix"],
  ["confirm", "always-fail"],
];

export function buildSoakGroup() {
  const cases: Array<{ name: string; run: () => Promise<void> }> = [];

  for (let index = 0; index < 10; index++) {
    cases.push({
      name: `soak repeat ${FIXTURES[index].id}`,
      run: async () => {
        const first = await run(index, "confirm", "fix");
        const second = await run(index, "confirm", "fix");
        assert.equal(stable(first), stable(second), "repeated runs diverged");
      },
    });
  }

  for (let index = 0; index < 10; index++) {
    const [proof, repair] = PAIRS[index % PAIRS.length];
    cases.push({
      name: `soak triple ${FIXTURES[index % FIXTURES.length].id} proof=${proof} repair=${repair}`,
      run: async () => {
        const first = await run(index, proof, repair);
        const second = await run(index, proof, repair);
        const third = await run(index, proof, repair);
        assert.equal(stable(first), stable(second));
        assert.equal(stable(second), stable(third));
      },
    });
  }

  for (let index = 0; index < 10; index++) {
    const [proofA, repairA] = PAIRS[index % PAIRS.length];
    const [proofB, repairB] = PAIRS[(index + 2) % PAIRS.length];
    cases.push({
      name: `soak alternating ${FIXTURES[index % FIXTURES.length].id} A=${proofA}/${repairA} B=${proofB}/${repairB}`,
      run: async () => {
        const a1 = await run(index, proofA, repairA);
        const b1 = await run(index, proofB, repairB);
        const a2 = await run(index, proofA, repairA);
        const b2 = await run(index, proofB, repairB);
        assert.equal(stable(a1), stable(a2), "behavior A not stable across interleaving");
        assert.equal(stable(b1), stable(b2), "behavior B not stable across interleaving");
      },
    });
  }

  assert.equal(cases.length, 30);
  return defineCases("soak", cases);
}
