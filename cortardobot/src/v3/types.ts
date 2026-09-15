import type { ModelSelection, ReasoningEffort } from "../../../shared/models.ts";

export type { ModelSelection, ReasoningEffort };

export type Severity = "critical" | "high" | "medium" | "low" | "info";

/** Honest terminal state of a finding. Published text must match exactly. */
export type FindingState = "VERIFIED_FIX" | "UNRESOLVED" | "UNSUPPORTED" | "FAILED";

export type Classification = "AUTH" | "API" | "DATABASE" | "UI" | "PERFORMANCE" | "CONFIG" | "UNKNOWN";

export type PRSize = "tiny" | "normal" | "complex";

export type ProofKind = "existing_test" | "targeted_test" | "script" | "browser" | "app_boot" | "none";

export type ProofStatus = "confirmed" | "disproven" | "likely" | "error";

export type RepairExit = "VERIFIED" | "UNRESOLVED" | "UNSAFE" | "BUDGET_EXHAUSTED";

export type AgentKind = "bug" | "auth" | "security" | "regression" | "runtime" | "performance" | "database" | "api" | "ui" | "config";

export interface ChangedFileInput {
  path: string;
  previousPath?: string;
  status?: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  content?: string;
  additions?: number;
  deletions?: number;
}

export interface ReviewRequest {
  runId: string;
  repo: {
    fullName: string;
    defaultBranch: string;
    installationId: number;
    cloneUrl: string;
    token: string;
  };
  pr: {
    number: number;
    title: string;
    body: string;
    author?: string;
    baseSha: string;
    headSha: string;
    baseBranch: string;
    headBranch: string;
    url?: string;
  };
  files: ChangedFileInput[];
  rules?: string[];
  learnings?: string[];
  settings?: {
    autoCommitFixes?: boolean;
    /** Per-run model selection (usually taken from repository settings). */
    models?: Partial<Record<"luna" | "terra" | "astra", string>>;
    reasoning?: Partial<Record<"luna" | "terra" | "astra", ReasoningEffort>>;
    /** Reviewer instructions supplied by a human or the app. */
    instructions?: string;
  };
  budgets?: Partial<BudgetConfig>;
}

export interface BudgetConfig {
  globalMs: number;
  sandboxSetupMs: number;
  swarmMs: number;
  judgeMs: number;
  proofMs: number;
  repairMs: number;
  verifyMs: number;
  astraMs: number;
  /** Budget for the baseline test-suite run captured at setup; 0 disables it. */
  baselineMs: number;
  maxModelCalls: number;
  maxRepairAttempts: number;
  maxCandidates: number;
  maxToProve: number;
  maxRepairs: number;
  maxBrowserChecks: number;
  /** Model-driven repair attempts before the deterministic fallback (default 2). */
  maxAgentAttempts: number;
  /** Model turns allowed within a single repair attempt (default 3). */
  maxAgentTurns: number;
  /** Tool calls allowed within a single turn (default 4). */
  maxToolCallsPerTurn: number;
  /** Investigation turns allowed per swarm investigator (default 3). */
  maxSwarmTurns: number;
  /** Tool calls allowed per swarm investigator turn (default 3). */
  maxSwarmToolsPerTurn: number;
  /** Hard ceiling on provider spend for one run in USD; 0 disables the check. */
  maxCostUsd: number;
}

export interface DiffLine {
  type: " " | "+" | "-" | "\\";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  lines: DiffLine[];
}

export interface ParsedFile {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "removed" | "renamed";
  language: string;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  addedLines: DiffLine[];
  removedLines: DiffLine[];
  content?: string;
  lines?: string[];
}

export interface PRContext {
  id: string;
  title: string;
  body: string;
  files: ParsedFile[];
  additions: number;
  deletions: number;
  classification: Classification[];
  size: PRSize;
  symbols: Array<{ name: string; kind: string; file: string; line: number; change: "added" | "removed" | "modified" }>;
  routes: string[];
  tests: string[];
  riskSignals: string[];
  pages: Array<{ file: string; route: string }>;
  packageManager: "npm" | "pnpm" | "yarn";
  hasTests: boolean;
  hasTypecheck: boolean;
  hasBuild: boolean;
  /** Repository learnings supplied by humans, already normalized (3.2). */
  learnings?: string[];
}

export interface Candidate {
  id: string;
  claim: string;
  severity: Severity;
  confidence: number;
  file?: string;
  line?: number;
  endLine?: number;
  evidence: string[];
  source: "detector" | "luna";
  agentKind: AgentKind;
  suggestedProof: ProofKind;
  check?: BrowserCheck;
  autoFix?: Array<{ path: string; find: string; replace: string }>;
  tags: string[];
  occurrences: number;
  score: number;
  mergedFrom: string[];
}

export interface BrowserCheck {
  path: string;
  clickText?: string;
  assert:
    | { type: "noPageError"; errorIncludes?: string }
    | { type: "pathEquals"; value: string }
    | { type: "textContains"; value: string }
    | { type: "textAbsent"; value: string };
  expected: "pass" | "fail";
  label: string;
}

export type JudgeVerdict = "PROVE" | "STATIC_ONLY" | "DISCARD";

export interface JudgeDecision {
  candidateId: string;
  verdict: JudgeVerdict;
  reason: string;
  priority: number;
}

export interface ProofAttempt {
  strategy: ProofKind;
  command: string;
  exitCode: number | null;
  timedOut: boolean;
  output: string;
  matched: boolean;
  durationMs: number;
  checks?: BrowserCheckResult[];
}

export interface BrowserCheckResult {
  id: string;
  path: string;
  passed: boolean;
  pageErrors: string[];
  consoleErrors: string[];
  detail: string;
  durationMs: number;
  /** True when the harness itself failed (navigation, click, timeout) — never a defect signal. */
  harnessError?: boolean;
}

export interface ProofResult {
  candidateId: string;
  status: ProofStatus;
  strategy: ProofKind;
  attempts: ProofAttempt[];
  reproduction: string;
  explanation: string;
  durationMs: number;
  servedFromCache?: boolean;
}

export interface RepairEdit {
  path: string;
  find: string;
  replace: string;
}

/** A model-authored probe captured during repair; promoted into verification (3.2). */
export interface AuthoredProbe {
  name: string;
  content: string;
  command: string;
  /** Probe result during the repair attempt: false means it failed before the fix. */
  passed: boolean;
  output?: string;
}

export type FailureCategory =
  | "apply_failed"
  | "no_edit"
  | "test_failed"
  | "typecheck_failed"
  | "reproduction_still_confirms"
  | "harness_error"
  | "model_error"
  | "timeout"
  | "unsafe";

/** Structured "why did the attempt fail" report fed into the next attempt. */
export interface FailureReport {
  category: FailureCategory;
  /** One-paragraph explanation of the failure (model-diagnosed when available). */
  summary: string;
  /** Truncated failing output / apply reason used as evidence. */
  evidence: string;
  /** Diff produced by the failed attempt, when it applied edits. */
  attemptedDiff?: string;
  /** Files the failed attempt touched. */
  files: string[];
  /** Materially different approach the next attempt must take. */
  nextStrategy: string;
}

export interface RepairAttempt {
  attempt: number;
  strategy: string;
  edits: RepairEdit[];
  applied: boolean;
  applyReason?: string;
  diagnosis?: string;
  /** Structured failure report for this attempt (3.2). */
  failure?: FailureReport;
  testPassed: boolean;
  testOutput?: string;
  exit?: RepairExit;
  /** Agent turns used in this attempt. */
  turns?: number;
  /** Tool calls executed in this attempt. */
  tools?: number;
  /** True when the attempt's edit produced no content change (rejected). */
  noop?: boolean;
}

export interface RepairResult {
  candidateId: string;
  severity: Severity;
  exit: RepairExit;
  attempts: RepairAttempt[];
  finalPatch?: string;
  finalEdits?: RepairEdit[];
  /** Last pre-fix failing probe from the successful attempt (3.2). */
  probe?: AuthoredProbe;
  durationMs: number;
  toolCalls: number;
  reason: string;
  agentTurns?: number;
  servedFromCache?: boolean;
  transcript?: AgentTranscript;
}

export interface VerificationStep {
  kind: "reproduction" | "authored_probe" | "targeted_tests" | "affected_tests" | "typecheck" | "build";
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

export interface AstraReview {
  candidateId: string;
  validity: "valid" | "uncertain" | "invalid";
  fixCorrectness: "correct" | "partial" | "incorrect" | "none";
  risk: "high" | "medium" | "low";
  approval: "approve" | "approve_with_comments" | "request_changes";
  confidence: number;
  summary: string;
}

export interface Finding {
  candidate: Candidate;
  proof: ProofResult;
  repair?: RepairResult;
  verification?: VerificationReport;
  review?: AstraReview;
}

// ── Agentic repair ──────────────────────────────────────────────────────────

export type ToolName =
  | "read_file"
  | "list_dir"
  | "find_files"
  | "search_code"
  | "get_symbols"
  | "find_references"
  | "get_tests_for"
  | "read_test"
  | "run_test_file"
  | "run_typecheck"
  | "run_build"
  | "apply_edit"
  | "git_diff"
  | "write_probe"
  | "run_probe"
  | "run_reproduction"
  | "finish";

export interface ToolCall {
  tool: ToolName;
  args: Record<string, unknown>;
}

export interface ToolObservation {
  tool: ToolName;
  ok: boolean;
  summary: string;
  detail: string;
  durationMs: number;
}

export interface AgentAction {
  thought?: string;
  actions?: ToolCall[];
  strategy?: string;
  rationale?: string;
  done?: boolean;
  summary?: string;
}

export interface AgentTurn {
  turn: number;
  thought?: string;
  actions: ToolCall[];
  observations: ToolObservation[];
  modelId: string;
  durationMs: number;
}

export interface AgentTranscript {
  candidateId: string;
  turns: AgentTurn[];
  toolCalls: number;
  truncated: boolean;
}

// ── Agentic swarm ───────────────────────────────────────────────────────────

export interface SwarmAgentReport {
  id: string;
  kind: AgentKind;
  title: string;
  status: "completed" | "error" | "budget";
  turns: number;
  toolCalls: number;
  hypotheses: number;
  candidates: number;
  durationMs: number;
  error?: string;
  transcript?: AgentTranscript;
}

export interface SwarmReport {
  mode: "agentic" | "single-shot";
  agents: SwarmAgentReport[];
  hypotheses: number;
  candidates: number;
  durationMs: number;
}

export interface ContextPackFile {
  path: string;
  content: string;
  numbered: string;
  hash: string;
  changed: boolean;
}

export interface ContextPack {
  candidateId: string;
  files: ContextPackFile[];
  imports: string[];
  symbols: string[];
  tests: string[];
  routes: string[];
  diff: string;
  reproduction: string;
  check?: BrowserCheck;
  detectorEvidence: string[];
  instructions?: string;
  /** Repository learnings injected into this pack (3.2). */
  learnings?: string[];
  hash: string;
}

// ── Cache ───────────────────────────────────────────────────────────────────

export interface CacheHit<T> {
  value: T;
  key: string;
  createdAt: number;
  hits: number;
  meta?: Record<string, unknown>;
}

export interface CacheSetInput<T> {
  key: string;
  kind: string;
  value: T;
  /** Optional TTL in milliseconds. */
  ttlMs?: number;
  meta?: Record<string, unknown>;
}

export interface CacheStatsSnapshot {
  hits: number;
  misses: number;
  writes: number;
  byKind: Record<string, { hits: number; misses: number; writes: number }>;
  creditsSavedUsd: number;
}

export interface RepairCachePayload {
  candidateId: string;
  exit: RepairExit;
  finalEdits: RepairEdit[];
  finalPatch: string;
  reason: string;
  attempts: RepairAttempt[];
  probe?: AuthoredProbe;
}

export interface StageEvent {
  stage: string;
  status: "started" | "completed" | "failed" | "skipped";
  at: number;
  durationMs?: number;
  detail?: string;
}

export interface Usage {
  calls: number;
  byRole: Record<string, number>;
  tokensIn: number;
  tokensOut: number;
  /** Tokens served from provider-side prompt cache (billed cheaper). */
  cachedTokensIn: number;
  costUsd: number;
  modelMs: number;
}

export interface ReviewResult {
  runId: string;
  status: "completed" | "failed";
  error?: string;
  pr: { id: string; title: string; classification: Classification[]; size: PRSize };
  context: PRContext | null;
  candidates: Candidate[];
  decisions: JudgeDecision[];
  proofs: ProofResult[];
  repairs: RepairResult[];
  verifications: Record<string, VerificationReport>;
  findings: Finding[];
  reviews: AstraReview[];
  swarm?: SwarmReport;
  events: StageEvent[];
  timings: Record<string, number>;
  usage: Usage;
  models: ModelSelection;
  cache: CacheStatsSnapshot;
  degraded?: boolean;
  degradedReason?: string;
  summary: {
    issuesFound: number;
    issuesConfirmed: number;
    issuesFixed: number;
    issuesVerified: number;
    staticOnly: number;
    discarded: number;
    durationMs: number;
    modelCalls: number;
    costUsd: number;
    cacheHits: number;
    cacheMisses: number;
    creditsSavedUsd: number;
    maxAttempts: number;
  };
  markdown: string;
}

export interface ModelMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ModelTask {
  role: "luna" | "terra" | "astra";
  kind: string;
  system: string;
  user: string;
  /** Prior conversation turns (kept stable so provider prompt caching can apply). */
  history?: ModelMessage[];
  expectJson?: boolean;
  timeoutMs?: number;
  maxTokens?: number;
  retries?: number;
  label: string;
}

export interface ModelResponse {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn?: number;
  durationMs: number;
  costUsd?: number;
}

export interface ModelClient {
  readonly id: string;
  complete(task: ModelTask): Promise<ModelResponse>;
}

export interface ExecResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface ApplyResult {
  ok: boolean;
  applied: RepairEdit[];
  failed: Array<{ edit: RepairEdit; reason: string }>;
}
