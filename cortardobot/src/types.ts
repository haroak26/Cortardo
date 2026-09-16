/**
 * CortardoBot 3.5 — engine types.
 *
 * Plain vocabulary only: a claim becomes a finding when a script fails because
 * of it; a fix is verified only when a fresh sandbox replays it. Every
 * candidate ends in exactly one terminal state.
 */
import type { ModelRole, ReasoningEffort, ModelSelection } from "../../shared/models.ts";

export type { ModelRole, ReasoningEffort, ModelSelection };

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

export interface ModelTask {
  role: ModelRole;
  /** Coarse call kind for logs and stats: plan | investigate | fix | diagnose | refresh | verify | report. */
  kind: string;
  system: string;
  user: string;
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  expectJson?: boolean;
  maxTokens?: number;
  timeoutMs?: number;
  retries?: number;
  signal?: AbortSignal;
  label?: string;
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

export interface Usage {
  calls: number;
  byRole: Partial<Record<ModelRole, number>>;
  tokensIn: number;
  tokensOut: number;
  cachedTokensIn: number;
  costUsd: number;
  modelMs: number;
}

// ---------------------------------------------------------------------------
// Repository graph (L0 from the server codegraph, L1 overlay in-engine)
// ---------------------------------------------------------------------------

export interface GraphFile {
  path: string;
  kind: string;
}

export interface GraphConnection {
  source: string;
  target: string;
  kind: string;
}

export interface GraphSymbol {
  id: string;
  fileId: string;
  name: string;
  qualifiedName: string;
  kind: string;
  line: number;
  endLine: number;
  signature: string;
  exported: boolean;
}

export interface GraphSymbolEdge {
  source: string;
  target: string;
  kind: string;
}

export interface GraphStringRef {
  path: string;
  value: string;
  line: number;
}

export interface RepoGraphInput {
  files?: GraphFile[];
  connections?: GraphConnection[];
  symbols?: GraphSymbol[];
  symbolEdges?: GraphSymbolEdge[];
  strings?: GraphStringRef[];
  knowledge?: Array<{ path: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Request / context
// ---------------------------------------------------------------------------

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "removed" | "renamed";
  patch?: string;
  content?: string;
  additions: number;
  deletions: number;
}

export interface DiffLine {
  type: "+" | "-" | " " | "\\";
  text: string;
  newLine?: number;
  oldLine?: number;
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
  status: ChangedFile["status"];
  language: string;
  additions: number;
  deletions: number;
  hunks: Hunk[];
  addedLines: DiffLine[];
  removedLines: DiffLine[];
  content?: string;
  lines?: string[];
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
  files: ChangedFile[];
  rules: string[];
  learnings: string[];
  settings: {
    models?: Partial<Record<ModelRole, string>>;
    reasoning?: Partial<Record<ModelRole, ReasoningEffort>>;
    instructions?: string;
    /** Runtime exercise can be turned off per repository. */
    runtime?: boolean;
  };
  /** L0 context supplied by the server (stored code graph + docs). */
  graph?: RepoGraphInput;
  /** Small repo anchor files (package.json, .env.example) for capability detection. */
  anchors?: Record<string, string>;
  /** All repo file paths known from the code graph (used for capability detection). */
  repoFiles?: string[];
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type FindingState = "reproduced" | "fix_failed" | "verified_fix";

export type CandidateState = FindingState | "not_reproduced" | "error" | "deferred";

export type RuntimeSurface = "ui" | "api" | "cli";

export interface ReproArtifact {
  /** Repo-relative path of the probe script inside the probe directory. */
  path: string;
  command: string;
  content: string;
  hash: string;
  /** How many times the probe failed before it was accepted. Always >= 2. */
  failures: number;
  /** What the reproduction exercises. */
  surface: "logic" | RuntimeSurface;
  /** Shell commands run before the reproduction (start the app, seed data). */
  setup?: string[];
  /** Shell commands run after the reproduction, always (stop the app). */
  teardown?: string[];
}

export interface ReproRecord {
  artifact: ReproArtifact;
  explanation: string;
  /** Combined output of the accepted failing run (truncated). */
  output: string;
}

export interface FixAttempt {
  attempt: number;
  summary: string;
  edits: RepairEdit[];
  failureCategory?:
    | "repro_still_fails"
    | "gate_failed"
    | "apply_failed"
    | "unsafe_edit"
    | "model_error"
    | "sandbox_error"
    | "no_edit"
    | "budget";
  failureDetail?: string;
  turns: number;
  toolCalls: number;
  durationMs: number;
}

export interface VerificationStep {
  kind: "repro_1" | "repro_2" | "typecheck" | "tests" | "review";
  passed: boolean;
  skipped?: boolean;
  reason: string;
  output?: string;
}

export interface ReviewVerdict {
  approved: boolean;
  risk: Severity;
  confidence: number;
  summary: string;
}

export interface FixRecord {
  state: "pending_verify" | "verified" | "failed" | "skipped";
  reason: string;
  patch?: string;
  edits?: RepairEdit[];
  attempts: FixAttempt[];
  verification?: {
    passed: boolean;
    steps: VerificationStep[];
  };
  reviewer?: ReviewVerdict;
}

export interface Finding {
  id: string;
  claim: string;
  severity: Severity;
  confidence: number;
  file: string;
  line?: number;
  evidence: string[];
  state: FindingState;
  suggestedExperiment?: string;
  repro: ReproRecord;
  fix?: FixRecord;
  /** Set for findings discovered by exercising the app at runtime. */
  runtime?: {
    surface: RuntimeSurface;
    /** True when the same scenario also failed on the base revision. */
    preExisting: boolean;
    baseReason?: string;
  };
}

export interface CandidateRecord {
  candidateId: string;
  claim: string;
  severity: Severity;
  file?: string;
  state: CandidateState;
  reason: string;
  runtime?: {
    surface: RuntimeSurface;
    preExisting: boolean;
  };
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

export interface ExecResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface RepairEdit {
  path: string;
  find: string;
  replace: string;
}

export interface ApplyResult {
  ok: boolean;
  applied: RepairEdit[];
  failed: Array<{ edit: RepairEdit; reason: string }>;
}

export interface RepoProfile {
  packageManager: "npm" | "pnpm" | "yarn" | "unknown";
  installCommand?: string;
  hasNodeModules: boolean;
  testCommand?: string;
  typecheckCommand?: string;
  buildCommand?: string;
  devCommand?: string;
  scripts: Record<string, string>;
  testFiles: string[];
}

export interface Sandbox {
  readonly id: string;
  readonly root: string;
  prepare(options: { cloneUrl: string; token: string; ref: string; headBranch?: string }): Promise<void>;
  install(): Promise<void>;
  profile(): Promise<RepoProfile>;
  exec(command: string, options?: { cwd?: string; timeoutMs?: number; allowFailure?: boolean; signal?: AbortSignal }): Promise<ExecResult>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir?: string): Promise<string[]>;
  gitDiff(): Promise<string>;
  startApp(options?: { port?: number; command?: string; readyPath?: string }): Promise<{ url: string; stop: () => Promise<void> }>;
  cleanup(): Promise<void>;
}

// ---------------------------------------------------------------------------
// Run result (server-facing)
// ---------------------------------------------------------------------------

export interface StageEvent {
  stage: string;
  status: "started" | "completed" | "failed" | "timed_out" | "skipped";
  detail?: string;
  at: number;
  durationMs?: number;
}

export interface RunSummary {
  /** Every hypothesis raised by investigators. */
  issuesFound: number;
  /** Findings reproduced by a failing script. */
  issuesConfirmed: number;
  issuesReproduced: number;
  /** Verified fixes (issuesConfirmed === issuesVerified after a clean verify). */
  issuesFixed: number;
  issuesVerified: number;
  /** Candidates recorded not_reproduced (advisory only). */
  staticOnly: number;
  deferred: number;
  errors: number;
  durationMs: number;
  modelCalls: number;
  costUsd: number;
}

export interface RunReport {
  verdict: {
    decision: "approve" | "approve_with_comments" | "request_changes";
    confidence: number;
    rationale: string;
  };
  summary: string;
  runtime?: {
    status: "exercised" | "skipped";
    surfaces: RuntimeSurface[];
    reason?: string;
  };
  reproduced: Array<{ id: string; claim: string; severity: Severity; file: string; line?: number }>;
  verified: Array<{ id: string; claim: string; severity: Severity; file: string; line?: number }>;
  unresolved: Array<{ id: string; claim: string; severity: Severity; file: string; state: CandidateState; reason: string }>;
  coverage: Array<{ id: string; claim: string; severity: Severity; state: CandidateState; reason: string }>;
}

export interface EngineResult {
  runId: string;
  status: "done" | "failed";
  error?: string;
  degraded: boolean;
  degradedReason?: string;
  pr: { classification: string[]; size: string };
  /** Parsed changed files (hunks + contents) for publishing and line mapping. */
  files: ParsedFile[];
  candidates: CandidateRecord[];
  findings: Finding[];
  summary: RunSummary;
  report: RunReport;
  models: ModelSelection;
  usage: Usage;
  timings: Record<string, number>;
  events: StageEvent[];
}
