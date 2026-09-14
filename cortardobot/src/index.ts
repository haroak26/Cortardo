export { CortadoEngine, createEngine, reviewPullRequest, type EngineOptions } from "./engine";
export { resolveConfig, DEFAULT_CONFIG, type CortadoConfig, type DeepPartial } from "./config";
export { buildCortadoGraph, type GraphDeps } from "./graph/pipeline";
export { CortadoStateAnnotation, type CortadoState } from "./graph/state";

export { analyzeChange, classifyPR, parseChangedFiles, extractSymbols } from "./stages/change-intelligence";
export { runSwarm, filesForAgent } from "./stages/swarm";
export { mergeEvidence } from "./stages/evidence-merge";
export { judgeCandidates, enforceJudgePolicy } from "./stages/judge";
export {
  proveCandidates,
  buildProofSteps,
  evaluateStep,
  relatedTests,
  strategiesFor,
  DEFAULT_REPO_COMMANDS,
  type RepoCommands,
} from "./stages/proof";
export { repairFindings, patchLines } from "./stages/repair";
export { verifyRepairs } from "./stages/verify";
export { reviewFindings, deterministicFinalReview } from "./stages/final-review";
export { assembleResult, buildFindings, formatResultMarkdown } from "./result";

export { DryModel, createDryModel, type DryModelOptions, type RepairBehavior } from "./models/dry";
export { OpenAiCompatibleClient } from "./models/live";
export { ModelRouter, createModelRouter } from "./models/router";
export type { ModelClient, ModelTask, ModelResponse, ModelRole } from "./models/types";

export { createSandbox, MemorySandbox, LocalSandbox, type Sandbox } from "./sandbox";
export { assessCommand, assessPatchSafety } from "./sandbox/safety";
export { createDrySimulationHandler, type DrySimulationOptions } from "./sandbox/dry-simulation";
export { deterministicJudge, maxProveFor, isExecutionProvable } from "./judge-policy";
export { applyUnifiedDiff, applyFilePatch, parseUnifiedDiff, makeUnifiedDiff } from "./util/diff";
export { systemClock, SimulatedClock, createDeadline, type Clock } from "./util/clock";
export { createLogger, silentLogger, type Logger } from "./util/logger";
export { DETECTORS, detectForFiles, detectorById, detectorFix } from "./agents/detectors";
export { selectAgents } from "./agents/roster";

export type * from "./types";
