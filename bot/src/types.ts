import type { CodeGraphSymbol, CodeGraphSymbolEdge } from "@shared/codegraph";

export type CodeBotStageName = "codegraph" | "hypotheses" | "fixes" | "verify";

/** Product pipeline: codegraph is internal and never publishes. */
export const CODEBOT_STAGES: CodeBotStageName[] = ["hypotheses", "fixes", "verify"];

export interface CodegraphChangedFile {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  /** Unified diff hunk text from GitHub; absent for large/binary files. */
  patch?: string;
}

export type HypothesisMechanism =
  | "resource-leak"
  | "crash"
  | "race"
  | "wrong-value"
  | "contract-break"
  | "swallowed-error"
  | "state-corruption"
  | "stale-state";

export type HypothesisSeverity = "critical" | "high" | "medium" | "low" | "info";

export const HYPOTHESIS_MECHANISMS: HypothesisMechanism[] = [
  "resource-leak",
  "crash",
  "race",
  "wrong-value",
  "contract-break",
  "swallowed-error",
  "state-corruption",
  "stale-state",
];

export const HYPOTHESIS_SEVERITIES: HypothesisSeverity[] = ["critical", "high", "medium", "low", "info"];

export interface HypothesisDownstream {
  /** Symbol outside the diff, when known (imports have none). */
  symbol: string;
  file: string;
  relation: "calls" | "imports";
}

/**
 * A change-specific risk hypothesis. Rules and the master agent both produce
 * hypotheses; only later stages may try to prove them.
 */
export interface Hypothesis {
  id: string;
  /** Deterministic rule id, or `master` for model-only hypotheses. */
  ruleId: string;
  source: "rule" | "model";
  mechanism: HypothesisMechanism;
  severity: HypothesisSeverity;
  confidence: number;
  file: string;
  line: number;
  /** The exact changed line this hypothesis is about. */
  snippet: string;
  symbol?: string;
  /** What changed, e.g. `timeoutMs: 5_000 → 30_000`. */
  change: string;
  /** The concrete failure path this change opens. */
  why: string;
  /** The one question whose answer would confirm or kill the hypothesis. */
  question: string;
  downstream: HypothesisDownstream[];
  /** 1 = fix first. Set by the coordinator synthesis, renumbered by the report. */
  priority?: number;
}

export interface ModelRoleUsage {
  id: string;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  /** Prompt tokens served from the provider cache, when reported. */
  cachedTokensIn: number;
  costUsd: number;
  /** Calls blocked by the budget or lost to transport before any cost. */
  failedCalls: number;
}

export interface ModelUsage {
  coordinator: ModelRoleUsage;
  swarm: ModelRoleUsage;
  codegen: ModelRoleUsage;
  totalCostUsd: number;
  maxCostUsd: number;
  /** True when the model tiers were active; false means deterministic-only. */
  used: boolean;
  reason?: string;
}

/** One unit of investigation handed to a swarm agent. */
export interface SwarmAssignment {
  id: string;
  kind: "lead" | "sweep";
  files: string[];
  /** Deterministic lead ids this assignment must check. */
  leads: string[];
  focus: string;
}

/** What one swarm agent reported back. */
export interface SwarmAgentReport {
  assignmentId: string;
  hypotheses: Hypothesis[];
  /** file:line pairs the agent says it actually read. */
  checked: string[];
  dropped: number;
  toolCalls: number;
  turns: number;
  /** Model spend attributed to this assignment. */
  usage?: {
    calls: number;
    tokensIn: number;
    tokensOut: number;
    cachedTokensIn: number;
    costUsd: number;
  };
  stoppedReason: string;
  failure?: string;
}

/** A noise-suppression entry learned from the repository. */
export interface HypothesisDismissal {
  fingerprint: string;
  reason: string;
  path?: string;
}

export interface HypothesisReport {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  indexCommitSha: string | null;
  hypotheses: Hypothesis[];
  totals: {
    hypotheses: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  usage: ModelUsage;
  dismissed: number;
  /** Duplicate findings merged into one advisory by the dedupe pass. */
  deduped: number;
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Stage 3 — fixes
// ---------------------------------------------------------------------------

/** What the coordinator (terra) intends to change, per hypothesis. */
export interface FixPlan {
  hypothesisId: string;
  summary: string;
  steps: string[];
  files: string[];
  risks?: string;
  testIdea?: string;
}

/** One exact find/replace edit produced by the codegen model (sol). */
export interface FixEdit {
  path: string;
  find: string;
  replace: string;
  /** True when the file is not part of the PR diff. */
  outsideDiff: boolean;
  /** 1-based line range of the `find` text in the head content, when known. */
  startLine?: number;
  endLine?: number;
  /** True when the whole range falls on new-side lines present in the patch. */
  inDiff?: boolean;
}

export type FixOutcome =
  | "generated"
  | "not_fixable"
  | "refused"
  | "failed"
  | "failed_transport"
  | "skipped"
  /** Plan published without a draft patch because the budget did not cover codegen. */
  | "plan_only";

export interface GeneratedFix {
  hypothesisId: string;
  priority: number;
  hypothesis: Hypothesis;
  plan?: FixPlan;
  edits: FixEdit[];
  summary: string;
  confidence: number;
  attempts: number;
  outcome: FixOutcome;
  reason?: string;
}

export interface FixReport {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  fixes: GeneratedFix[];
  totals: {
    /** Hypotheses handed to the stage. */
    available: number;
    /** Hypotheses considered after the maxFixes cap. */
    hypotheses: number;
    /** Hypotheses excluded by the priority severity gate. */
    filtered?: number;
    generated: number;
    notFixable: number;
    refused: number;
    failed: number;
    failedTransport: number;
    skipped: number;
    planOnly: number;
  };
  usage: ModelUsage;
  /** Native GitHub suggestion comments posted for this run. */
  suggestions: {
    posted: number;
    skipped: number;
    error?: string;
  };
  warnings: string[];
}

export interface CodegraphSymbolSummary {
  id: string;
  name: string;
  qualifiedName: string;
  kind: string;
  line: number;
  endLine: number;
  signature: string;
  exported: boolean;
  parent: string | null;
}

export interface CodegraphCaller {
  symbol: string;
  file: string;
  via: string;
}

export interface CodegraphCallee {
  symbol: string;
  file: string;
}

export interface CodegraphFileGraph {
  path: string;
  status: string;
  additions: number;
  deletions: number;
  language: string;
  kind: string;
  loc: number;
  indexed: boolean;
  symbols: CodegraphSymbolSummary[];
  imports: Array<{ path: string; changed: boolean }>;
  importedBy: string[];
  callers: CodegraphCaller[];
  callees: CodegraphCallee[];
  tests: string[];
}

export interface CodegraphReport {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  indexCommitSha: string | null;
  indexFileCount: number;
  files: CodegraphFileGraph[];
  unsupported: string[];
  missingFromIndex: string[];
  warnings: string[];
  totals: {
    files: number;
    indexed: number;
    symbols: number;
    callers: number;
    tests: number;
  };
}

/** Structural subset of the stored repository codegraph the stage consumes. */
export interface RepoGraphIndex {
  commitSha: string | null;
  files: Array<{ id: string; path: string; language: string; kind: string; loc: number }>;
  connections: Array<{ source: string; target: string; kind: string }>;
  symbols: CodeGraphSymbol[];
  symbolEdges: CodeGraphSymbolEdge[];
}

export interface CodeBotRunInput {
  repositoryId: string;
  pullRequestNumber: number;
  stages?: CodeBotStageName[];
  runId?: string;
  dryRun?: boolean;
  maxFiles?: number;
}

export interface CodeBotStageResult {
  stage: CodeBotStageName;
  version: string;
  durationMs: number;
  headSha: string;
  summary: string;
  body: string;
  commentId: number | null;
  commentUrl: string | null;
  replacedComments: number;
}

export interface CodeBotRunResult {
  runId: string;
  version: string;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  published: boolean;
  /** The single review comment posted by the run (null on dry runs). */
  commentId: number | null;
  commentUrl: string | null;
  /** The single review comment body (also built on dry runs). */
  body: string;
  /** Run-cumulative model usage across every stage that ran. */
  usage?: ModelUsage;
  /** Machine-readable receipt, logged as one JSON line per run. */
  receipt: CodeBotRunReceipt;
  stages: CodeBotStageResult[];
}

export interface CodeBotStageReceipt {
  stage: CodeBotStageName;
  status: "ok";
  durationMs: number;
  summary: string;
  commentId: number | null;
  usage?: ModelUsage;
}

export interface CodeBotRunReceipt {
  runId: string;
  version: string;
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  /** The single review comment id, when one was published. */
  commentId: number | null;
  targetCostUsd: number;
  maxCostUsd: number;
  reserveUsd: number;
  totalCostUsd: number;
  totalCalls: number;
  cacheHitRate: number;
  stages: CodeBotStageReceipt[];
}

/** Internal handoff: stage 2 returns its structured report for stage 3. */
export interface HypothesisStageResult extends CodeBotStageResult {
  report: HypothesisReport;
}

/** Internal handoff: stage 3 returns its structured report. */
export interface FixStageResult extends CodeBotStageResult {
  report: FixReport;
  /** The hypotheses the fixes were planned from; used by the combined review. */
  hypothesisReport?: HypothesisReport;
}

// ---------------------------------------------------------------------------
// Stage 4 — verify (the autmpus loop)
// ---------------------------------------------------------------------------

/** One command the coordinator (terra) wants run in the sandbox. */
export interface VerifyCommand {
  cmd: string;
  why: string;
  timeoutMs: number;
}

/** A small test or probe file terra writes into the sandbox before verifying. */
export interface VerifyProbeFile {
  path: string;
  content: string;
}

export interface VerifyPlan {
  install?: string;
  commands: VerifyCommand[];
  probeFiles: VerifyProbeFile[];
  /** Commands in `commands` expected to fail on the unfixed head. */
  mustFailBefore: string[];
  notes?: string;
  source: "terra" | "fallback" | "override";
}

export interface SandboxCommandRun {
  cmd: string;
  why?: string;
  exitCode: number;
  timedOut: boolean;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
  /** True when the command actually executed repository code (imports, tests), not just source text. */
  behavioral: boolean;
}

/**
 * How the fix was proven to work, strongest first. `static` means a probe or
 * command only inspected source text — it never executed the changed code.
 */
export type VerifyEvidence = "reproduction" | "probe" | "tests" | "compile" | "static" | "none";

export type VerifyAttemptStatus = "passed" | "failed" | "apply_failed" | "repair_unavailable" | "stalled";

export interface VerifyAttempt {
  attempt: number;
  kind: "initial" | "repair";
  status: VerifyAttemptStatus;
  edits: FixEdit[];
  applyErrors: string[];
  runs: SandboxCommandRun[];
  /** Commands that failed both on the pristine head and with the fix. */
  preExisting: string[];
  /** `mustFailBefore` commands that failed before and passed after. */
  reproductions: number;
  /** Reproductions that actually executed repository code, not just source text. */
  behavioralReproductions: number;
  /** Terra's diagnosis when the attempt failed. */
  diagnosis?: string;
  durationMs: number;
}

export type VerifyFixStatus = "verified" | "unverified" | "skipped" | "inconclusive";

export interface VerifiedFix {
  hypothesisId: string;
  priority: number;
  severity: HypothesisSeverity;
  hypothesis: Hypothesis;
  plan?: FixPlan;
  /** The final, verified edit set (empty when never generated). */
  edits: FixEdit[];
  /** Probe files from the final harness, published so the evidence is auditable. */
  probeFiles?: VerifyProbeFile[];
  status: VerifyFixStatus;
  evidence: VerifyEvidence;
  reason?: string;
  attemptsUsed: number;
  attempts: VerifyAttempt[];
  baseline?: { runs: SandboxCommandRun[]; durationMs: number };
  install?: SandboxCommandRun;
  sandboxId: string;
  durationMs: number;
}

export interface VerifyReport {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  fixes: VerifiedFix[];
  totals: {
    /** Generated fixes handed to the stage, before the severity/priority gate. */
    available: number;
    /** Fixes selected for verification (critical/high by default). */
    eligible: number;
    verified: number;
    unverified: number;
    skipped: number;
    inconclusive: number;
    reproductions: number;
    /** Verified fixes whose evidence ran the changed code (reproduction/probe/tests). */
    behavioral: number;
    attempts: number;
    commands: number;
  };
  sandbox: {
    id: string | null;
    template: string;
    created: boolean;
    cloneMs?: number;
    installMs?: number;
    error?: string;
  };
  usage: ModelUsage;
  suggestions: {
    posted: number;
    skipped: number;
    /** Draft suggestions deleted before the verified set was posted. */
    removed: number;
    error?: string;
  };
  warnings: string[];
}

/** Internal handoff: stage 4 returns its structured report. */
export interface VerifyStageResult extends CodeBotStageResult {
  report: VerifyReport;
  /** Upstream reports rebuilt when earlier stages did not run. */
  hypothesisReport?: HypothesisReport;
  fixReport?: FixReport;
}
