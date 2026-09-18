import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFixReport,
  buildSuggestionBody,
  collectSuggestions,
  lineRangeAt,
  parseFixPlans,
  parseRawEdits,
  runCodegenAgent,
  validateFixEdits,
} from "../src/fixes.ts";
import { renderFixDiff } from "../src/patch.ts";
import { buildFixesComment, FIXES_MARKER } from "../src/markdown.ts";
import { parsePatches } from "../src/patch.ts";
import type {
  CortardoBotCompleteInput,
  CortardoBotModelClient,
  CortardoBotModelCompletion,
  CortardoBotModelConfig,
  CortardoBotSwarmConfig,
} from "../src/model.ts";
import type { CodegraphChangedFile, CodegraphReport, GeneratedFix, Hypothesis, RepoGraphIndex } from "../src/types.ts";

const MODEL_CONFIG: CortardoBotModelConfig = {
  model: "scripted:terra",
  swarmModel: "scripted:luna",
  codegenModel: "scripted:sol",
  baseUrl: "http://localhost:1234",
  apiKey: "test-key",
  timeoutMs: 1_000,
  maxRetries: 0,
  maxTokens: 100,
  reasoning: "medium",
};

const SWARM_CONFIG: CortardoBotSwarmConfig = {
  maxAgents: 6,
  concurrency: 2,
  maxTurns: 3,
  maxToolsPerTurn: 2,
  maxCostUsd: 0.3,
  timeoutMs: 10_000,
  searchEnabled: true,
  learningsEnabled: true,
  maxFixes: 0,
  fixSeverities: ["critical", "high"],
  codegenConcurrency: 2,
  codegenTurns: 3,
  verifyEnabled: true,
  verifyAttempts: 4,
  verifyTimeoutMs: 30_000,
  verifyCommandTimeoutMs: 10_000,
  verifyCommands: [],
  e2bTemplate: "test-template",
  e2bTimeoutMs: 60_000,
};

const FILES: CodegraphChangedFile[] = [
  {
    path: "src/db.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: ["@@ -10,4 +10,4 @@", " export function withPool() {", "-  const timeoutMs = 5_000;", "+  const timeoutMs = 30_000;", " }"].join("\n"),
  },
];

const PATCHES = parsePatches(FILES);

const INDEX: RepoGraphIndex = {
  commitSha: "abc",
  files: [{ id: "src/db.ts", path: "src/db.ts", language: "TypeScript", kind: "source", loc: 20 }],
  connections: [],
  symbols: [],
  symbolEdges: [],
};

const REPORT: CodegraphReport = {
  repository: "acme/app",
  pullRequestNumber: 7,
  headSha: "74c5449d",
  indexCommitSha: null,
  indexFileCount: 0,
  files: [],
  unsupported: [],
  missingFromIndex: [],
  warnings: [],
  totals: { files: 0, indexed: 0, symbols: 0, callers: 0, tests: 0 },
};

function hypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: "s_abc123",
    ruleId: "threshold-change",
    source: "rule",
    mechanism: "resource-leak",
    severity: "high",
    confidence: 0.7,
    file: "src/db.ts",
    line: 11,
    snippet: "  const timeoutMs = 30_000;",
    symbol: "withPool",
    change: "timeoutMs: 5_000 → 30_000",
    why: "the pool fills under load",
    question: "what bounds concurrent holders?",
    downstream: [],
    priority: 1,
    ...overrides,
  };
}

test("parseFixPlans accepts valid plans and not-fixable entries", () => {
  const result = parseFixPlans(
    JSON.stringify({
      fixes: [
        { hypothesisId: "s_abc123", summary: "lower the timeout", steps: ["set it back to 5s"], files: ["src/db.ts"], risks: "slower queries" },
        { hypothesisId: "s_ghost", summary: "x", steps: ["y"], files: ["z"] },
        { hypothesisId: "s_abc123", summary: "duplicate", steps: ["y"], files: [] },
      ],
      notFixable: [{ hypothesisId: "s_def456", reason: "needs a product decision" }],
    }),
    { hypotheses: [hypothesis(), hypothesis({ id: "s_def456" })], maxFixes: 0 },
  );
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].summary, "lower the timeout");
  assert.equal(result.dropped, 2);
  assert.equal(result.notFixable.get("s_def456"), "needs a product decision");
});

test("parseFixPlans caps plans when maxFixes is set", () => {
  const result = parseFixPlans(
    JSON.stringify({
      fixes: [
        { hypothesisId: "s_a", summary: "one", steps: ["a"], files: [] },
        { hypothesisId: "s_b", summary: "two", steps: ["b"], files: [] },
      ],
    }),
    { hypotheses: [hypothesis({ id: "s_a" }), hypothesis({ id: "s_b" })], maxFixes: 1 },
  );
  assert.equal(result.plans.length, 1);
});

test("validateFixEdits rejects missing, ambiguous and identical edits", async () => {
  const content = "const a = 1;\nconst b = 1;\n";
  const result = await validateFixEdits(
    [
      { path: "src/a.ts", find: "missing text", replace: "x" },
      { path: "src/a.ts", find: "const b = 1;", replace: "const b = 1;" },
      { path: "src/a.ts", find: "const", replace: "let" },
      { path: "src/ghost.ts", find: "x", replace: "y" },
    ],
    {
      changedFiles: new Set(["src/a.ts"]),
      readFile: async (path) => (path === "src/a.ts" ? content : undefined),
    },
  );
  assert.equal(result.edits.length, 0);
  assert.equal(result.errors.length, 4);
  assert.ok(result.errors.some((error) => error.includes("does not appear")));
  assert.ok(result.errors.some((error) => error.includes("identical")));
  assert.ok(result.errors.some((error) => error.includes("appears 2 times")));
  assert.ok(result.errors.some((error) => error.includes("could not be read")));
});

test("validateFixEdits accepts unique edits and flags files outside the diff", async () => {
  const result = await validateFixEdits([{ path: "src/other.ts", find: "const a = 1;", replace: "const a = 2;" }], {
    changedFiles: new Set(["src/db.ts"]),
    readFile: async () => "const a = 1;\n",
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.edits.length, 1);
  assert.equal(result.edits[0].outsideDiff, true);
});

test("renderFixDiff renders a draft patch from the edit pair", () => {
  const diff = renderFixDiff([{ path: "src/db.ts", find: "const a = 1;", replace: "const a = 2;" }]);
  assert.ok(diff.includes("--- a/src/db.ts"));
  assert.ok(diff.includes("+++ b/src/db.ts"));
  assert.ok(diff.includes("-const a = 1;"));
  assert.ok(diff.includes("+const a = 2;"));
});

test("parseRawEdits ignores malformed entries", () => {
  const edits = parseRawEdits({
    edits: [
      { path: "src/db.ts", find: "a", replace: "b" },
      { path: "", find: "a", replace: "b" },
      { path: "src/db.ts", find: "", replace: "b" },
      "nope",
    ],
  });
  assert.equal(edits.length, 1);
});

class ScriptedClient implements CortardoBotModelClient {
  readonly id: string;
  readonly calls: CortardoBotCompleteInput[] = [];
  constructor(
    id: string,
    private readonly handler: (call: number) => string | Error,
  ) {
    this.id = id;
  }
  async complete(input: CortardoBotCompleteInput): Promise<CortardoBotModelCompletion> {
    this.calls.push(input);
    const result = this.handler(this.calls.length);
    if (result instanceof Error) throw result;
    return { text: result, model: this.id, tokensIn: 100, tokensOut: 40, costUsd: 0.01, durationMs: 3 };
  }
}

function codegenInput(client: CortardoBotModelClient, readFile?: (path: string) => Promise<string | undefined>) {
  return {
    repository: "acme/app",
    pullRequestNumber: 7,
    title: "raise timeouts",
    headSha: "74c5449d",
    hypothesis: hypothesis(),
    plan: { hypothesisId: "s_abc123", summary: "lower the timeout", steps: ["set it back"], files: ["src/db.ts"] },
    files: FILES,
    patches: PATCHES,
    analyses: new Map(),
    report: REPORT,
    index: INDEX,
    client,
    config: SWARM_CONFIG,
    deadline: Date.now() + 5_000,
    readFile: readFile ?? (async () => "export function withPool() {\n  const timeoutMs = 30_000;\n}\n"),
  };
}

test("runCodegenAgent validates edits produced after a tool read", async () => {
  const client = new ScriptedClient("scripted:sol", (call) =>
    call === 1
      ? JSON.stringify({ thought: "read", actions: [{ tool: "read_file", args: { path: "src/db.ts" } }], done: false })
      : JSON.stringify({
          edits: [{ path: "src/db.ts", find: "const timeoutMs = 30_000;", replace: "const timeoutMs = 5_000;" }],
          summary: "restore the timeout",
          confidence: 0.8,
        }),
  );
  const result = await runCodegenAgent(codegenInput(client));
  assert.equal(result.errors.length, 0);
  assert.equal(result.edits.length, 1);
  assert.equal(result.edits[0].outsideDiff, false);
  assert.equal(result.attempts, 1);
  assert.equal(result.confidence, 0.8);
  assert.equal(result.refused, undefined);
});

test("runCodegenAgent retries once with the validation error", async () => {
  const client = new ScriptedClient("scripted:sol", (call) => {
    if (call === 1) return JSON.stringify({ thought: "read", actions: [{ tool: "read_file", args: { path: "src/db.ts" } }], done: false });
    if (call === 2) return JSON.stringify({ edits: [{ path: "src/db.ts", find: "missing text", replace: "x" }], summary: "bad", confidence: 0.5 });
    return JSON.stringify({
      edits: [{ path: "src/db.ts", find: "const timeoutMs = 30_000;", replace: "const timeoutMs = 5_000;" }],
      summary: "fixed",
      confidence: 0.7,
    });
  });
  const result = await runCodegenAgent(codegenInput(client));
  assert.equal(result.attempts, 2);
  assert.equal(result.edits.length, 1);
  assert.ok(client.calls[2].user.includes("Previous attempt failed"));
});

test("runCodegenAgent reports a refusal", async () => {
  const client = new ScriptedClient("scripted:sol", (call) =>
    call === 1
      ? JSON.stringify({ thought: "read", actions: [{ tool: "read_file", args: { path: "src/db.ts" } }], done: false })
      : JSON.stringify({ refused: true, reason: "the intent is ambiguous" }),
  );
  const result = await runCodegenAgent(codegenInput(client));
  assert.equal(result.refused, "the intent is ambiguous");
  assert.equal(result.edits.length, 0);
});

const PLAN_JSON = JSON.stringify({
  fixes: [{ hypothesisId: "s_abc123", summary: "lower the timeout", steps: ["set it back to 5s"], files: ["src/db.ts"] }],
});
const CODEGEN_JSON = JSON.stringify({
  edits: [{ path: "src/db.ts", find: "const timeoutMs = 30_000;", replace: "const timeoutMs = 5_000;" }],
  summary: "restore the timeout",
  confidence: 0.8,
});

function fixReportInput(overrides: Record<string, unknown> = {}) {
  return {
    repository: "acme/app",
    pullRequestNumber: 7,
    headSha: "74c5449d",
    title: "raise timeouts",
    hypotheses: [hypothesis()],
    files: FILES,
    patches: PATCHES,
    analyses: new Map(),
    report: REPORT,
    index: INDEX,
    modelConfig: MODEL_CONFIG,
    swarmConfig: SWARM_CONFIG,
    readFile: async () => "export function withPool() {\n  const timeoutMs = 30_000;\n}\n",
    ...overrides,
  };
}

test("buildFixReport plans and generates a validated draft", async () => {
  const coordinator = new ScriptedClient("scripted:terra", () => PLAN_JSON);
  const codegen = new ScriptedClient("scripted:sol", (call) =>
    call === 1
      ? JSON.stringify({ thought: "read", actions: [{ tool: "read_file", args: { path: "src/db.ts" } }], done: false })
      : CODEGEN_JSON,
  );
  const report = await buildFixReport({ ...fixReportInput(), coordinatorClient: coordinator, codegenClient: codegen });

  assert.equal(report.totals.generated, 1);
  assert.equal(report.fixes[0].outcome, "generated");
  assert.equal(report.fixes[0].edits.length, 1);
  assert.equal(report.fixes[0].priority, 1);
  assert.equal(report.usage.codegen.calls, 2);
  assert.equal(report.usage.coordinator.calls, 1);
  assert.deepEqual(
    [...new Set(coordinator.calls.map((call) => call.cacheKey))],
    ["cortardo-bot:coordinator:acme/app:7:74c5449d"],
    "the terra planner sends one prompt cache key",
  );
  assert.deepEqual(
    [...new Set(codegen.calls.map((call) => call.cacheKey))],
    ["cortardo-bot:codegen:acme/app:7:74c5449d"],
    "every codegen turn shares one prompt cache key",
  );

  const body = buildFixesComment({ report, runId: "cortardo-bot-test", version: "0.2.0" });
  assert.ok(body.includes(FIXES_MARKER));
  assert.ok(body.includes("## Cortardo Bot · Stage 3: fixes"));
  assert.ok(body.includes("unverified draft"));
  assert.ok(body.includes("```diff"));
  assert.ok(body.includes("--- a/src/db.ts"));
  assert.ok(body.includes("Codegen: `scripted:sol` ×2"));
});

test("buildFixReport records not-fixable and refused outcomes", async () => {
  const coordinator = new ScriptedClient("scripted:terra", () =>
    JSON.stringify({
      fixes: [{ hypothesisId: "s_def456", summary: "other", steps: ["x"], files: [] }],
      notFixable: [{ hypothesisId: "s_abc123", reason: "needs a product decision" }],
    }),
  );
  const codegen = new ScriptedClient("scripted:sol", () => CODEGEN_JSON);
  const report = await buildFixReport({
    ...fixReportInput(),
    hypotheses: [hypothesis(), hypothesis({ id: "s_def456", priority: 2 })],
    coordinatorClient: coordinator,
    codegenClient: codegen,
  });
  assert.equal(report.totals.notFixable, 1);
  assert.equal(report.fixes.find((fix) => fix.hypothesisId === "s_abc123")?.outcome, "not_fixable");
  assert.match(report.fixes.find((fix) => fix.hypothesisId === "s_abc123")?.reason ?? "", /product decision/);
});

test("buildFixReport skips everything when the planner fails", async () => {
  const coordinator = new ScriptedClient("scripted:terra", () => new Error("402 spend limit"));
  const codegen = new ScriptedClient("scripted:sol", () => CODEGEN_JSON);
  const report = await buildFixReport({ ...fixReportInput(), coordinatorClient: coordinator, codegenClient: codegen });
  assert.equal(report.totals.generated, 0);
  assert.equal(report.totals.skipped, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("fix planning failed")));
});

test("buildFixReport stops codegen at the cost budget", async () => {
  const coordinator = new ScriptedClient("scripted:terra", () => PLAN_JSON);
  const codegen = new ScriptedClient("scripted:sol", () => CODEGEN_JSON);
  const report = await buildFixReport({
    ...fixReportInput({ swarmConfig: { ...SWARM_CONFIG, maxCostUsd: 0.005 } }),
    coordinatorClient: coordinator,
    codegenClient: codegen,
  });
  assert.equal(report.totals.generated, 0);
  assert.equal(report.totals.skipped, 1);
  assert.match(report.fixes[0].reason ?? "", /budget/);
  assert.equal(codegen.calls.length, 0);
});

test("buildFixReport only fixes the priority severities (critical/high)", async () => {
  const coordinator = new ScriptedClient("scripted:terra", () => PLAN_JSON);
  const codegen = new ScriptedClient("scripted:sol", () => CODEGEN_JSON);
  const report = await buildFixReport({
    ...fixReportInput({
      hypotheses: [
        hypothesis(),
        hypothesis({ id: "s_low", severity: "low", priority: 1 }),
        hypothesis({ id: "s_crit", severity: "critical", priority: 2 }),
      ],
    }),
    coordinatorClient: coordinator,
    codegenClient: codegen,
  });
  assert.equal(report.totals.available, 3);
  assert.equal(report.totals.filtered, 1);
  assert.ok(!report.fixes.some((fix) => fix.hypothesisId === "s_low"), "low severity is not fixed");
  assert.ok(report.fixes.some((fix) => fix.hypothesisId === "s_crit"), "critical severity stays in scope");
  assert.ok(report.warnings.some((warning) => warning.includes("non-priority")));
});

test("buildFixReport is deterministic-only without model clients", async () => {
  const report = await buildFixReport({ ...fixReportInput(), coordinatorClient: null, codegenClient: null });
  assert.equal(report.totals.skipped, 1);
  assert.equal(report.usage.used, false);
  const body = buildFixesComment({ report, runId: "cortardo-bot-test", version: "0.2.0" });
  assert.ok(body.includes("No hypotheses were available to fix.") === false);
  assert.ok(body.includes("`skipped`"));
});

test("lineRangeAt maps the find text to head line numbers", () => {
  const content = "const a = 1;\nconst b = 2;\nconst c = 3;\n";
  assert.deepEqual(lineRangeAt(content, "const b = 2;"), { startLine: 2, endLine: 2 });
  assert.deepEqual(lineRangeAt(content, "const b = 2;\nconst c = 3;"), { startLine: 2, endLine: 3 });
  assert.equal(lineRangeAt(content, "missing"), undefined);
});

test("validateFixEdits marks suggestions that fall on new-side patch lines", async () => {
  const content = "line one\nconst b = 2;\nline three\n";
  const newSideLines = new Map([["src/a.ts", new Set([2, 3])]]);
  const result = await validateFixEdits([{ path: "src/a.ts", find: "const b = 2;", replace: "const b = 4;" }], {
    changedFiles: new Set(["src/a.ts"]),
    readFile: async () => content,
    newSideLines,
  });
  assert.equal(result.edits[0].startLine, 2);
  assert.equal(result.edits[0].inDiff, true);

  const outside = await validateFixEdits([{ path: "src/a.ts", find: "line one", replace: "line 1" }], {
    changedFiles: new Set(["src/a.ts"]),
    readFile: async () => content,
    newSideLines,
  });
  assert.equal(outside.edits[0].inDiff, false);
});

test("collectSuggestions only plans in-diff edits and keeps out-of-diff ones out", () => {
  const report: GeneratedFix[] = [
    {
      hypothesisId: "s_a",
      priority: 1,
      hypothesis: hypothesis(),
      edits: [
        { path: "src/db.ts", find: "a", replace: "b", outsideDiff: false, startLine: 11, endLine: 11, inDiff: true },
        { path: "src/other.ts", find: "c", replace: "d", outsideDiff: true, startLine: 4, endLine: 4, inDiff: false },
      ],
      summary: "fix",
      confidence: 0.8,
      attempts: 1,
      outcome: "generated",
    },
  ];
  const { suggestions, skipped } = collectSuggestions(report);
  assert.equal(suggestions.length, 1);
  assert.equal(suggestions[0].path, "src/db.ts");
  assert.equal(skipped, 1);
  assert.ok(suggestions[0].body.includes("<!-- cortardo-bot:fix s_a -->"));
  assert.ok(suggestions[0].body.includes("```suggestion"));
});

test("runCodegenAgent retries a transport failure and reports it when persistent", async () => {
  const flaky = new ScriptedClient("scripted:sol", (call) => {
    if (call === 1) return new Error("transient provider error: overloaded");
    return JSON.stringify({ edits: [{ path: "src/db.ts", find: "const timeoutMs = 30_000;", replace: "const timeoutMs = 5_000;" }], summary: "fixed", confidence: 0.7 });
  });
  const recovered = await runCodegenAgent(codegenInput(flaky));
  assert.equal(recovered.transportFailure, undefined);
  assert.equal(recovered.edits.length, 1);

  const broken = new ScriptedClient("scripted:sol", () => new Error("model request failed with status 500"));
  const failed = await runCodegenAgent(codegenInput(broken));
  assert.match(failed.transportFailure ?? "", /500/);
  assert.equal(failed.edits.length, 0);
  assert.equal(failed.attempts, 2);
});

test("buildFixReport records a transport failure as failed_transport", async () => {
  const coordinator = new ScriptedClient("scripted:terra", () => PLAN_JSON);
  const codegen = new ScriptedClient("scripted:sol", () => new Error("model request failed with status 503"));
  const report = await buildFixReport({ ...fixReportInput(), coordinatorClient: coordinator, codegenClient: codegen });
  assert.equal(report.totals.failedTransport, 1);
  assert.equal(report.fixes[0].outcome, "failed_transport");
  assert.match(report.fixes[0].reason ?? "", /503/);
});

test("buildFixesComment announces inline suggestions and cache stats", async () => {
  const coordinator = new ScriptedClient("scripted:terra", () => PLAN_JSON);
  const codegen = new ScriptedClient("scripted:sol", (call) =>
    call === 1
      ? JSON.stringify({ thought: "read", actions: [{ tool: "read_file", args: { path: "src/db.ts" } }], done: false })
      : CODEGEN_JSON,
  );
  const report = await buildFixReport({ ...fixReportInput(), coordinatorClient: coordinator, codegenClient: codegen });
  report.suggestions = { posted: 1, skipped: 0 };
  report.usage.codegen.cachedTokensIn = 4096;
  const body = buildFixesComment({ report, runId: "cortardo-bot-test", version: "0.2.0" });
  assert.ok(body.includes("1 inline suggestion(s)"));
  assert.ok(body.includes("4096 cached"));
});
