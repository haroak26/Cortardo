import { buildAnalysisGroup } from "./groups/analysis";
import { buildDiffGroup } from "./groups/diff";
import { buildEngineGroup } from "./groups/engine";
import { buildPipelineGroup } from "./groups/pipeline";
import { buildRuntimeGroup } from "./groups/runtime";
import type { ExhaustiveCase } from "./types";

export const EXHAUSTIVE_TARGET = 250;

export function buildExhaustiveCases(): ExhaustiveCase[] {
  return [
    ...buildDiffGroup(),
    ...buildAnalysisGroup(),
    ...buildPipelineGroup(),
    ...buildRuntimeGroup(),
    ...buildEngineGroup(),
  ];
}
