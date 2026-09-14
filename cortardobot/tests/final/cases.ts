import { buildBudgetGroup } from "./groups/budgets";
import { buildCliGroup } from "./groups/cli";
import { buildConsistencyGroup } from "./groups/consistency";
import { buildDetectorsDeepGroup } from "./groups/detectors-deep";
import { buildIntelligenceDeepGroup } from "./groups/intelligence-deep";
import { buildPipelineDeepGroup } from "./groups/pipeline-deep";
import { buildResultPermutationGroup } from "./groups/result-permutations";
import { buildSandboxFailureGroup } from "./groups/sandbox-failures";
import { buildSoakGroup } from "./groups/soak";
import { buildTransportGroup } from "./groups/transport";
import type { ExhaustiveCase } from "../exhaustive/types";

export const FINAL_TARGET = 287;

export function buildFinalCases(): ExhaustiveCase[] {
  const cases = [
    ...buildCliGroup(),
    ...buildSandboxFailureGroup(),
    ...buildBudgetGroup(),
    ...buildTransportGroup(),
    ...buildResultPermutationGroup(),
    ...buildDetectorsDeepGroup(),
    ...buildIntelligenceDeepGroup(),
    ...buildConsistencyGroup(),
    ...buildSoakGroup(),
    ...buildPipelineDeepGroup(),
  ];
  if (cases.length !== FINAL_TARGET) {
    throw new Error(`final suite expected ${FINAL_TARGET} cases, found ${cases.length}`);
  }
  return cases;
}
