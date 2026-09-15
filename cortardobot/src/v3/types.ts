export type Severity = "critical" | "high" | "medium" | "low" | "info";

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
  settings?: { autoCommitFixes?: boolean };
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
  maxModelCalls: number;
  maxRepairAttempts: number;
  maxCandidates: number;
  maxToProve: number;
  maxRepairs: number;
  maxBrowserChecks: number;
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
}

export interface ProofResult {
  candidateId: string;
  status: ProofStatus;
  strategy: ProofKind;
  attempts: ProofAttempt[];
  reproduction: string;
  explanation: string;
  durationMs: number;
}

export interface RepairEdit {
  path: string;
  find: string;
  replace: string;
}

export interface RepairAttempt {
  attempt: number;
  strategy: string;
  edits: RepairEdit[];
  applied: boolean;
  applyReason?: string;
  diagnosis?: string;
  testPassed: boolean;
  testOutput?: string;
  exit?: RepairExit;
}

export interface RepairResult {
  candidateId: string;
  severity: Severity;
  exit: RepairExit;
  attempts: RepairAttempt[];
  finalPatch?: string;
  finalEdits?: RepairEdit[];
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
  events: StageEvent[];
  timings: Record<string, number>;
  usage: Usage;
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
  };
  markdown: string;
}

export interface ModelTask {
  role: "luna" | "terra" | "astra";
  kind: string;
  system: string;
  user: string;
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
