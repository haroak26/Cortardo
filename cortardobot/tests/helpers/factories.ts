import type {
  ChangedFile,
  Finding,
  Hypothesis,
  MergedCandidate,
  PRContext,
  ProofResult,
  RepairResult,
  Severity,
  VerificationReport,
} from "../../src/types";

export function makeHypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: overrides.id ?? "h_test_1",
    claim: overrides.claim ?? "A testable defect exists in the changed code",
    evidence: overrides.evidence ?? ["src/app.ts:10"],
    severity: overrides.severity ?? "high",
    confidence: overrides.confidence ?? 0.8,
    suggestedExperiment: overrides.suggestedExperiment ?? "Run the focused test",
    agent: overrides.agent ?? "luna-bug",
    agentKind: overrides.agentKind ?? "bug",
    file: overrides.file ?? "src/app.ts",
    symbol: overrides.symbol,
    tags: overrides.tags ?? ["bug"],
  };
}

export function makeCandidate(overrides: Partial<MergedCandidate> = {}): MergedCandidate {
  const id = overrides.id ?? "c_test_1";
  return {
    id,
    claim: overrides.claim ?? "A testable defect exists in the changed code",
    severity: overrides.severity ?? "high",
    confidence: overrides.confidence ?? 0.8,
    evidence: overrides.evidence ?? ["src/app.ts:10"],
    suggestedExperiment: overrides.suggestedExperiment ?? "Run the focused test",
    file: overrides.file ?? "src/app.ts",
    symbol: overrides.symbol,
    tags: overrides.tags ?? ["bug"],
    agent: overrides.agent ?? "luna-bug",
    agentKind: overrides.agentKind ?? "bug",
    mergedFrom: overrides.mergedFrom ?? ["h_test_1"],
    occurrences: overrides.occurrences ?? 1,
    score: overrides.score ?? 3.2,
  };
}

export function makeProof(overrides: Partial<ProofResult> = {}): ProofResult {
  return {
    hypothesisId: overrides.hypothesisId ?? "c_test_1",
    candidateId: overrides.candidateId ?? "c_test_1",
    status: overrides.status ?? "confirmed",
    strategy: overrides.strategy ?? "existing_test",
    attempts: overrides.attempts ?? [],
    command: "command" in overrides ? overrides.command : "npm test -- src/app.test.ts",
    output: overrides.output ?? "AssertionError",
    durationMs: overrides.durationMs ?? 10,
    explanation: overrides.explanation ?? "Reproduced",
    reproduction: overrides.reproduction,
  };
}

export function makeRepair(overrides: Partial<RepairResult> = {}): RepairResult {
  return {
    candidateId: overrides.candidateId ?? "c_test_1",
    severity: overrides.severity ?? "high",
    exit: overrides.exit ?? "VERIFIED",
    attempts: overrides.attempts ?? [],
    finalPatch: overrides.finalPatch,
    durationMs: overrides.durationMs ?? 10,
    toolCalls: overrides.toolCalls ?? 2,
    reason: overrides.reason ?? "fix verified",
  };
}

export function makeVerification(overrides: Partial<VerificationReport> = {}): VerificationReport {
  return {
    passed: overrides.passed ?? true,
    steps: overrides.steps ?? [],
    durationMs: overrides.durationMs ?? 5,
  };
}

export function makeFinding(overrides: Partial<Finding> = {}): Finding {
  const candidateId = overrides.candidateId ?? "c_test_1";
  return {
    id: overrides.id ?? `f_${candidateId}`,
    candidateId,
    title: overrides.title ?? "A testable defect exists",
    severity: overrides.severity ?? ("high" as Severity),
    confidence: overrides.confidence ?? 0.8,
    file: overrides.file ?? "src/app.ts",
    evidence: overrides.evidence ?? ["src/app.ts:10"],
    proof: overrides.proof ?? makeProof({ candidateId }),
    repair: overrides.repair,
    verification: overrides.verification,
    review: overrides.review,
  };
}

export function makeChangedFile(path: string, options: {
  content?: string;
  added?: string[];
  removed?: string[];
  status?: ChangedFile["status"];
  language?: string;
} = {}): ChangedFile {
  return {
    path,
    status: options.status ?? "modified",
    language: options.language ?? "TypeScript",
    additions: (options.added ?? []).length,
    deletions: (options.removed ?? []).length,
    addedLines: (options.added ?? []).map((text, index) => ({ line: index + 1, text })),
    removedLines: (options.removed ?? []).map((text, index) => ({ line: index + 1, text })),
    content: options.content,
  };
}

export function makeContext(overrides: Partial<PRContext> = {}): PRContext {
  return {
    id: overrides.id ?? "pr_test",
    title: overrides.title ?? "Test PR",
    body: overrides.body ?? "",
    files: overrides.files ?? [makeChangedFile("src/app.ts", { added: ["export function run() { return 1; }"] })],
    symbols: overrides.symbols ?? [],
    dependencies: overrides.dependencies ?? [],
    callers: overrides.callers ?? [],
    tests: overrides.tests ?? [],
    routes: overrides.routes ?? [],
    configFiles: overrides.configFiles ?? [],
    riskSignals: overrides.riskSignals ?? [],
    classification: overrides.classification ?? ["UNKNOWN"],
    size: overrides.size ?? "tiny",
    stats: overrides.stats ?? { files: 1, additions: 3, deletions: 0, changedLines: 3 },
    repoRules: overrides.repoRules ?? [],
  };
}

export function contentFile(path: string, content: string, status: ChangedFile["status"] = "modified"): ChangedFile {
  return makeChangedFile(path, {
    content,
    added: content.split("\n"),
    status,
    language: path.endsWith(".py") ? "Python" : "TypeScript",
  });
}
