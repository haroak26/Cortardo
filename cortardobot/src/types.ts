export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type PRClassification =
  | "AUTH"
  | "API"
  | "DATABASE"
  | "UI"
  | "PERFORMANCE"
  | "CONFIG"
  | "UNKNOWN";

export type PRSize = "tiny" | "normal" | "complex";

export type PipelineStage =
  | "change_intelligence"
  | "sandbox_setup"
  | "swarm"
  | "evidence_merge"
  | "judge"
  | "proof"
  | "repair"
  | "verify"
  | "findings"
  | "final_review"
  | "assemble"
  | "cleanup";

export interface ChangedFileInput {
  path: string;
  status?: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  content?: string;
  additions?: number;
  deletions?: number;
}

export interface PullRequestInput {
  id?: string;
  title: string;
  body?: string;
  author?: string;
  baseBranch?: string;
  headBranch?: string;
  files: ChangedFileInput[];
  repoRules?: string[];
}

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  language: string;
  additions: number;
  deletions: number;
  patch?: string;
  content?: string;
  addedLines: DiffLine[];
  removedLines: DiffLine[];
}

export interface DiffLine {
  line: number;
  text: string;
}

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "route"
  | "config"
  | "test";

export interface ChangedSymbol {
  name: string;
  kind: SymbolKind;
  file: string;
  line: number;
  change: "added" | "modified" | "removed";
}

export interface DependencyEdge {
  from: string;
  to: string;
  kind: "imports" | "calls" | "uses";
}

export interface RiskSignal {
  id: string;
  detail: string;
  weight: number;
}

export interface PRContext {
  id: string;
  title: string;
  body: string;
  author?: string;
  baseBranch?: string;
  headBranch?: string;
  files: ChangedFile[];
  symbols: ChangedSymbol[];
  dependencies: DependencyEdge[];
  callers: string[];
  tests: string[];
  routes: string[];
  configFiles: string[];
  riskSignals: RiskSignal[];
  classification: PRClassification[];
  size: PRSize;
  stats: { files: number; additions: number; deletions: number; changedLines: number };
  repoRules: string[];
}

export interface Hypothesis {
  id: string;
  claim: string;
  evidence: string[];
  severity: Severity;
  confidence: number;
  suggestedExperiment: string;
  agent: string;
  agentKind: AgentKind;
  file?: string;
  symbol?: string;
  tags: string[];
}

export interface AgentSpec {
  id: string;
  kind: AgentKind;
  title: string;
  focus: string;
  priority: number;
}

export type AgentKind =
  | "bug"
  | "auth"
  | "security"
  | "regression"
  | "runtime"
  | "performance"
  | "database"
  | "api"
  | "ui"
  | "config";

export interface MergedCandidate {
  id: string;
  claim: string;
  severity: Severity;
  confidence: number;
  evidence: string[];
  suggestedExperiment: string;
  file?: string;
  symbol?: string;
  tags: string[];
  agent: string;
  agentKind: AgentKind;
  mergedFrom: string[];
  occurrences: number;
  score: number;
}

export type JudgeVerdict = "PROVE" | "STATIC_ONLY" | "DISCARD";

export interface JudgeDecision {
  hypothesisId: string;
  verdict: JudgeVerdict;
  reason: string;
  priority: number;
  reproductionCommand?: string;
}

export type ProofStrategy =
  | "existing_test"
  | "targeted_test"
  | "script"
  | "http"
  | "browser"
  | "full_environment";

export type ProofStatus = "confirmed" | "likely" | "disproven" | "error";

export interface ProofStep {
  strategy: ProofStrategy;
  command: string;
  expectation: "fail" | "pass" | "marker";
  marker?: string;
  description: string;
}

export interface ProofAttempt {
  step: ProofStep;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  matched: boolean;
  durationMs: number;
}

export interface ProofResult {
  hypothesisId: string;
  candidateId: string;
  status: ProofStatus;
  strategy: ProofStrategy;
  attempts: ProofAttempt[];
  command?: string;
  output?: string;
  durationMs: number;
  explanation: string;
  reproduction?: string;
}

export type RepairExitState = "VERIFIED" | "UNRESOLVED" | "UNSAFE" | "BUDGET_EXHAUSTED";

export interface RepairAttempt {
  attempt: number;
  strategy: string;
  patch: string;
  applied: boolean;
  applyReason?: string;
  diagnosis?: string;
  testPassed: boolean;
  testOutput?: string;
  exit?: RepairExitState;
}

export interface RepairResult {
  candidateId: string;
  severity: Severity;
  exit: RepairExitState;
  attempts: RepairAttempt[];
  finalPatch?: string;
  durationMs: number;
  toolCalls: number;
  reason: string;
}

export interface VerificationStep {
  kind: "reproduction" | "targeted_tests" | "affected_tests" | "typecheck" | "build";
  command: string;
  passed: boolean;
  skipped: boolean;
  reason: string;
  durationMs: number;
  output?: string;
}

export interface VerificationReport {
  passed: boolean;
  steps: VerificationStep[];
  durationMs: number;
}

export interface FinalReview {
  candidateId: string;
  validity: "valid" | "uncertain" | "invalid";
  fixCorrectness: "correct" | "partial" | "incorrect" | "none";
  risk: "high" | "medium" | "low";
  approval: "approve" | "approve_with_comments" | "request_changes";
  confidence: number;
  summary: string;
}

export interface Finding {
  id: string;
  candidateId: string;
  title: string;
  severity: Severity;
  confidence: number;
  file?: string;
  evidence: string[];
  proof: ProofResult;
  repair?: RepairResult;
  verification?: VerificationReport;
  review?: FinalReview;
}

export interface StageEvent {
  stage: PipelineStage;
  status: "started" | "completed" | "failed" | "skipped";
  at: number;
  durationMs?: number;
  detail?: string;
}

export interface UsageSnapshot {
  calls: number;
  callsByRole: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  credits: number;
  modelMs: number;
}

export interface CortadoSummary {
  issuesFound: number;
  issuesConfirmed: number;
  issuesFixed: number;
  issuesVerified: number;
  issuesStaticOnly: number;
  issuesDiscarded: number;
  durationMs: number;
  modelCalls: number;
  credits: number;
  exitStates: Record<RepairExitState, number>;
}

export interface CortadoResult {
  runId: string;
  status: "completed" | "failed";
  error?: string;
  dryRun: boolean;
  pr: { id: string; title: string; classification: PRClassification[]; size: PRSize };
  context: PRContext | null;
  candidates: MergedCandidate[];
  decisions: JudgeDecision[];
  proofs: ProofResult[];
  repairs: RepairResult[];
  findings: Finding[];
  reviews: FinalReview[];
  events: StageEvent[];
  timings: Partial<Record<PipelineStage, number>>;
  usage: UsageSnapshot;
  summary: CortadoSummary;
  markdown: string;
}
