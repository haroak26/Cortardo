import { FIXTURES } from "../../fixtures/prs";
import { detectForFiles } from "../../src/agents/detectors";
import { parseChangedFiles } from "../../src/stages/change-intelligence";
import { runScenario } from "./run-case";
import { assertScenarioResult, type AssertContext } from "./assertions";
import type { RepairBehavior } from "../../src/models/dry";
import type { ProofBehavior } from "./scenario";

const PROOF_BEHAVIORS: ProofBehavior[] = ["confirm", "no-repro", "flaky", "timeout", "missing-deps"];
const REPAIR_BEHAVIORS: RepairBehavior[] = ["fix", "wrong-layer", "always-fail", "unsafe", "timeout"];

const ALL_AGENT_KINDS = [
  "bug",
  "auth",
  "security",
  "regression",
  "runtime",
  "performance",
  "database",
  "api",
  "ui",
  "config",
] as const;

export interface DryCase {
  fixture: (typeof FIXTURES)[number];
  proof: ProofBehavior;
  repair: RepairBehavior;
  name: string;
}

export function buildDryCases(): DryCase[] {
  const cases: DryCase[] = [];
  for (const fixture of FIXTURES) {
    for (const proof of PROOF_BEHAVIORS) {
      for (const repair of REPAIR_BEHAVIORS) {
        cases.push({
          fixture,
          proof,
          repair,
          name: `${fixture.id} proof=${proof} repair=${repair}`,
        });
      }
    }
  }
  return cases;
}

export async function runDryCase(dryCase: DryCase): Promise<void> {
  const { result } = await runScenario({
    fixture: dryCase.fixture,
    proof: dryCase.proof,
    repair: dryCase.repair,
  });
  const detectedRules = new Set(
    detectForFiles(parseChangedFiles(dryCase.fixture.pullRequest.files), [...ALL_AGENT_KINDS], 200).map(
      (finding) => finding.ruleId,
    ),
  );
  const context: AssertContext = {
    fixture: dryCase.fixture,
    proof: dryCase.proof,
    repair: dryCase.repair,
    detectedRules,
  };
  assertScenarioResult(result, context);
}

export const DRY_CASE_COUNT = buildDryCases().length;
