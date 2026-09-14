import { Annotation } from "@langchain/langgraph";
import type {
  CortadoResult,
  FinalReview,
  Finding,
  Hypothesis,
  JudgeDecision,
  MergedCandidate,
  PipelineStage,
  PRContext,
  ProofResult,
  PullRequestInput,
  RepairResult,
  StageEvent,
  VerificationReport,
} from "../types";

export const CortadoStateAnnotation = Annotation.Root({
  input: Annotation<PullRequestInput>({
    reducer: (_left, right) => right,
    default: () => ({ title: "", files: [] }),
  }),
  context: Annotation<PRContext | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  hypotheses: Annotation<Hypothesis[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  candidates: Annotation<MergedCandidate[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  decisions: Annotation<JudgeDecision[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  proofs: Annotation<ProofResult[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  repairs: Annotation<RepairResult[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  verifications: Annotation<Record<string, VerificationReport>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  findings: Annotation<Finding[]>({
    reducer: (_left, right) => right,
    default: () => [],
  }),
  reviews: Annotation<FinalReview[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  result: Annotation<CortadoResult | null>({
    reducer: (_left, right) => right,
    default: () => null,
  }),
  events: Annotation<StageEvent[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  timings: Annotation<Partial<Record<PipelineStage, number>>>({
    reducer: (left, right) => ({ ...left, ...right }),
    default: () => ({}),
  }),
  status: Annotation<"completed" | "failed">({
    reducer: (_left, right) => right,
    default: () => "completed",
  }),
  error: Annotation<string | undefined>({
    reducer: (_left, right) => right,
    default: () => undefined,
  }),
  stageErrors: Annotation<string[]>({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
  runId: Annotation<string>({
    reducer: (_left, right) => right,
    default: () => "run",
  }),
  startedAt: Annotation<number>({
    reducer: (_left, right) => right,
    default: () => 0,
  }),
  dryRun: Annotation<boolean>({
    reducer: (_left, right) => right,
    default: () => true,
  }),
});

export type CortadoState = typeof CortadoStateAnnotation.State;
export type CortadoStateUpdate = typeof CortadoStateAnnotation.Update;
