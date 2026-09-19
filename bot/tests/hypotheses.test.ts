import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraphSymbol } from "@shared/codegraph";
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import { buildCodegraphReport } from "../src/codegraph.ts";
import { hypothesisId, scanHypotheses } from "../src/rules.ts";
import { buildHypothesisReport } from "../src/hypotheses.ts";
import { buildHypothesesComment, HYPOTHESES_MARKER } from "../src/markdown.ts";
import { createCodeBotUsageTracker } from "../src/model.ts";
import type {
  CodeBotCompleteInput,
  CodeBotModelClient,
  CodeBotModelCompletion,
  CodeBotModelConfig,
  CodeBotSwarmConfig,
} from "../src/model.ts";
import type { CodegraphChangedFile, RepoGraphIndex, HypothesisDismissal } from "../src/types.ts";

const MODEL_CONFIG: CodeBotModelConfig = {
  model: "z-ai/glm-5.3",
  swarmModel: "openai/gpt-5-nano",
  codegenModel: "openai/gpt-5.6-sol",
  baseUrl: "http://localhost:1234",
  apiKey: "test-key",
  timeoutMs: 1_000,
  maxRetries: 0,
  maxTokens: 100,
  reasoning: "medium",
};

const SWARM_CONFIG: CodeBotSwarmConfig = {
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

function symbol(fileId: string, name: string, overrides: Partial<CodeGraphSymbol> = {}): CodeGraphSymbol {
  return {
    id: `${fileId}#${name}`,
    fileId,
    name,
    qualifiedName: name,
    kind: "function",
    line: 1,
    endLine: 10,
    signature: `function ${name}()`,
    exported: true,
    parent: null,
    ...overrides,
  };
}

function analysis(path: string, overrides: Partial<FileAnalysis> = {}): FileAnalysis {
  return {
    analyzeVersion: 3,
    path,
    language: "TypeScript",
    kind: "source",
    loc: 40,
    imports: [],
    namespaces: [],
    calls: [],
    types: [],
    declarations: [],
    symbols: [],
    symbolCalls: [],
    ...overrides,
  };
}

function indexFixture(): RepoGraphIndex {
  return {
    commitSha: "3f7d3774f15816cafc6119ef71805a890488bfb3",
    files: [
      { id: "src/db.ts", path: "src/db.ts", language: "TypeScript", kind: "source", loc: 40 },
      { id: "src/orders.ts", path: "src/orders.ts", language: "TypeScript", kind: "source", loc: 30 },
      { id: "src/pricing.ts", path: "src/pricing.ts", language: "TypeScript", kind: "source", loc: 20 },
      { id: "src/cart.ts", path: "src/cart.ts", language: "TypeScript", kind: "source", loc: 25 },
    ],
    connections: [
      { source: "src/orders.ts", target: "src/db.ts", kind: "imports" },
      { source: "src/cart.ts", target: "src/pricing.ts", kind: "imports" },
    ],
    symbols: [symbol("src/db.ts", "withPool"), symbol("src/orders.ts", "getOrders"), symbol("src/pricing.ts", "price"), symbol("src/cart.ts", "total")],
    symbolEdges: [
      { source: "src/orders.ts#getOrders", target: "src/db.ts#withPool", kind: "calls" },
      { source: "src/cart.ts#total", target: "src/pricing.ts#price", kind: "calls" },
    ],
  };
}

function reportFor(files: CodegraphChangedFile[], analyses: Map<string, FileAnalysis> = new Map()) {
  return buildCodegraphReport({
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "a9a43b844bc406a7db6266a338af8c1de09786fe",
    files,
    analyses,
    index: indexFixture(),
  });
}

function scan(files: CodegraphChangedFile[], analyses: Map<string, FileAnalysis> = new Map()) {
  return scanHypotheses({ files, analyses, report: reportFor(files, analyses) });
}

test("threshold change names the mechanism and the downstream caller", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "src/db.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: ["@@ -10,4 +10,4 @@", " export function withPool() {", "-  const timeoutMs = 5_000;", "+  const timeoutMs = 30_000;", " }"].join("\n"),
    },
  ];
  const analyses = new Map([
    ["src/db.ts", analysis("src/db.ts", { symbols: [symbol("src/db.ts", "withPool", { line: 10, endLine: 20 })] })],
  ]);
  const result = scan(files, analyses);

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "threshold-change");
  assert.ok(hypothesis, `expected a threshold hypothesis, got ${JSON.stringify(result.hypotheses.map((entry) => entry.ruleId))}`);
  assert.equal(hypothesis.mechanism, "resource-leak");
  assert.equal(hypothesis.severity, "high");
  assert.equal(hypothesis.file, "src/db.ts");
  assert.equal(hypothesis.line, 11);
  assert.equal(hypothesis.symbol, "withPool");
  assert.equal(hypothesis.change, "timeoutMs: 5_000 → 30_000");
  assert.ok(hypothesis.downstream.some((ref) => ref.file === "src/orders.ts" && ref.relation === "calls"));
});

test("removed export with external callers is a contract break", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "src/pricing.ts",
      status: "modified",
      additions: 0,
      deletions: 3,
      patch: ["@@ -1,4 +1,1 @@", " export const tax = 0.2;", "-export function price(items) {", "-  return items.length;", "-}"].join("\n"),
    },
  ];
  const result = scan(files, new Map([["src/pricing.ts", analysis("src/pricing.ts")]]));

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "contract-change");
  assert.ok(hypothesis);
  assert.equal(hypothesis.mechanism, "contract-break");
  assert.equal(hypothesis.severity, "high");
  assert.equal(hypothesis.change, "removed export price");
  assert.equal(hypothesis.symbol, "price");
  assert.ok(hypothesis.downstream.some((ref) => ref.file === "src/cart.ts" && ref.relation === "calls"));
});

test("a storage key written in the diff and read in the same diff is flagged", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "src/state.ts",
      status: "modified",
      additions: 2,
      deletions: 0,
      patch: [
        "@@ -1,2 +1,4 @@",
        " const id = getActive();",
        '+localStorage.setItem("ag.activeWorkspaceId", String(id));',
        '+const current = localStorage.getItem("ag.activeWorkspaceId");',
      ].join("\n"),
    },
  ];
  const result = scan(files);

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "state-key-write");
  assert.ok(hypothesis);
  assert.equal(hypothesis.mechanism, "state-corruption");
  assert.equal(hypothesis.change, 'writes storage key "ag.activeWorkspaceId"');
  assert.equal(hypothesis.confidence, 0.5);
  assert.match(hypothesis.why, /src\/state\.ts:3/);
});

test("a non-id value written to an id key is flagged without a reader in the diff", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "client/src/pages/Billing.tsx",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: [
        "@@ -1,1 +1,2 @@",
        ' import { useEffect } from "react";',
        '+  window.localStorage.setItem("ag.activeWorkspaceId", plan);',
      ].join("\n"),
    },
  ];
  const result = scan(files);

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "state-key-mismatch");
  assert.ok(hypothesis);
  assert.equal(hypothesis.mechanism, "state-corruption");
  assert.equal(hypothesis.change, 'writes plan to storage key "ag.activeWorkspaceId"');
  assert.equal(hypothesis.severity, "medium");
  assert.match(hypothesis.question, /expect an id/);
});

test("a reversed ternary mapping is flagged as a wrong value", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "client/src/pages/Usage.tsx",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: [
        "@@ -25,7 +25,7 @@",
        ' const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");',
        '-  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;',
        '+  const days = period === "7d" ? 30 : period === "30d" ? 7 : 90;',
      ].join("\n"),
    },
  ];
  const result = scan(files);

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "condition-change");
  assert.ok(hypothesis, `expected a condition hypothesis, got ${JSON.stringify(result.hypotheses.map((entry) => entry.ruleId))}`);
  assert.equal(hypothesis.mechanism, "wrong-value");
  assert.equal(hypothesis.severity, "high");
  assert.equal(hypothesis.confidence, 0.7);
  assert.match(hypothesis.change, /"7d": 7 → 30/);
});

test("a flipped comparison is flagged", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "src/guard.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: ["@@ -1,2 +1,2 @@", "-if (user !== null) {", "+if (user === null) {"].join("\n"),
    },
  ];
  const result = scan(files);
  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "condition-change");
  assert.ok(hypothesis);
  assert.match(hypothesis.change, /!== → ===/);
});

test("an empty catch block is flagged as a swallowed error", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "src/save.ts",
      status: "modified",
      additions: 1,
      deletions: 0,
      patch: ["@@ -1,1 +1,2 @@", " export async function save() {", "+  try { await persist(); } catch (error) {}"].join("\n"),
    },
  ];
  const result = scan(files);

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "empty-catch");
  assert.ok(hypothesis);
  assert.equal(hypothesis.mechanism, "swallowed-error");
  assert.equal(hypothesis.severity, "medium");
});

test("a removed fallback guard is flagged as a crash risk", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "src/user.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      patch: ["@@ -1,2 +1,2 @@", '-const name = user?.name ?? "anonymous";', "+const name = user.name;"].join("\n"),
    },
  ];
  const result = scan(files);

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "guard-removal");
  assert.ok(hypothesis);
  assert.equal(hypothesis.mechanism, "crash");
  assert.equal(hypothesis.confidence, 0.35);
});

test("a removed close call is flagged as a resource leak", () => {
  const files: CodegraphChangedFile[] = [
    {
      path: "src/pool.ts",
      status: "modified",
      additions: 0,
      deletions: 1,
      patch: ["@@ -1,3 +1,2 @@", " const pool = getPool();", "-connection.close();", " return pool;"].join("\n"),
    },
  ];
  const result = scan(files);

  const hypothesis = result.hypotheses.find((entry) => entry.ruleId === "cleanup-removal");
  assert.ok(hypothesis);
  assert.equal(hypothesis.mechanism, "resource-leak");
  assert.equal(hypothesis.severity, "high");
});

test("files without a patch, removed files and lockfiles produce nothing", () => {
  const files: CodegraphChangedFile[] = [
    { path: "src/big.ts", status: "modified", additions: 9, deletions: 1 },
    { path: "src/old.ts", status: "removed", additions: 0, deletions: 9 },
    { path: "package-lock.json", status: "modified", additions: 9, deletions: 9, patch: "@@ -1,1 +1,2 @@\n+x\n" },
    { path: "README.md", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n+timeout = 1" },
  ];
  const result = scan(files);
  assert.deepEqual(result.hypotheses, []);
});

class ScriptedClient implements CodeBotModelClient {
  readonly id: string;
  readonly calls: CodeBotCompleteInput[] = [];
  constructor(
    id: string,
    private readonly handler: (call: number, input: CodeBotCompleteInput) => string | Error,
  ) {
    this.id = id;
  }
  async complete(input: CodeBotCompleteInput): Promise<CodeBotModelCompletion> {
    this.calls.push(input);
    const result = this.handler(this.calls.length, input);
    if (result instanceof Error) throw result;
    return { text: result, model: this.id, tokensIn: 120, tokensOut: 45, costUsd: 0.002, durationMs: 4 };
  }
}

const THRESHOLD_FILE: CodegraphChangedFile = {
  path: "src/db.ts",
  status: "modified",
  additions: 1,
  deletions: 1,
  patch: ["@@ -10,4 +10,4 @@", " export function withPool() {", "-  const timeoutMs = 5_000;", "+  const timeoutMs = 30_000;", " }"].join("\n"),
};
const THRESHOLD_ANALYSES = new Map([
  ["src/db.ts", analysis("src/db.ts", { symbols: [symbol("src/db.ts", "withPool", { line: 10, endLine: 20 })] })],
]);

const PLAN_JSON = JSON.stringify({
  assignments: [{ id: "a1", kind: "lead", files: ["src/db.ts"], leads: [], focus: "verify the timeout" }],
});
const SWARM_TOOL_JSON = JSON.stringify({
  thought: "read the file",
  actions: [{ tool: "read_file", args: { path: "src/db.ts" } }],
  done: false,
});
const SWARM_FINAL_JSON = JSON.stringify({
  hypotheses: [
    {
      file: "src/db.ts",
      line: 11,
      mechanism: "resource-leak",
      severity: "high",
      confidence: 0.85,
      change: "timeoutMs: 5_000 → 30_000",
      why: "every order holds a pool connection for 30s, so the pool fills under load",
      question: "what bounds concurrent holders?",
      downstream: [{ file: "src/orders.ts", symbol: "getOrders", relation: "calls" }],
    },
  ],
});
const SYNTHESIS_JSON = JSON.stringify({
  hypotheses: [
    {
      file: "src/db.ts",
      line: 11,
      mechanism: "resource-leak",
      severity: "high",
      confidence: 0.9,
      change: "timeoutMs: 5_000 → 30_000",
      why: "synthesized: the pool fills under load",
      question: "what bounds concurrent holders?",
    },
  ],
});

function swarmClient(hypotheses: string = SWARM_FINAL_JSON): ScriptedClient {
  return new ScriptedClient("scripted:luna", (call) => (call === 1 ? SWARM_TOOL_JSON : hypotheses));
}

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "a9a43b844bc406a7db6266a338af8c1de09786fe",
    title: "raise timeouts",
    files: [THRESHOLD_FILE],
    analyses: THRESHOLD_ANALYSES,
    index: indexFixture(),
    modelConfig: MODEL_CONFIG,
    swarmConfig: SWARM_CONFIG,
    installationId: 1,
    fullName: "acme/app",
    readFile: async () => "export function withPool() {\n  const timeoutMs = 30_000;\n}\n",
    searchCode: async () => [],
    ...overrides,
  };
}

test("full swarm run uses both tiers and publishes per-role usage", async () => {
  const coordinator = new ScriptedClient("scripted:terra", (call) => (call === 1 ? PLAN_JSON : SYNTHESIS_JSON));
  const luna = swarmClient();
  const report = await buildHypothesisReport({
    ...buildInput(),
    modelClient: coordinator,
    swarmClient: luna,
  });

  assert.equal(report.usage.used, true);
  assert.equal(report.usage.coordinator.id, "scripted:terra");
  assert.equal(report.usage.coordinator.calls, 2);
  assert.equal(report.usage.swarm.id, "scripted:luna");
  assert.equal(report.usage.swarm.calls, 2);
  assert.equal(report.usage.totalCostUsd, 0.008);
  assert.equal(report.totals.hypotheses, 1);
  assert.equal(report.hypotheses[0].why, "synthesized: the pool fills under load");

  assert.deepEqual(
    [...new Set(coordinator.calls.map((call) => call.cacheKey))],
    ["codebot:coordinator:acme/app:6:a9a43b844bc4"],
    "every terra call shares one prompt cache key",
  );
  assert.deepEqual(
    [...new Set(luna.calls.map((call) => call.cacheKey))],
    ["codebot:swarm:acme/app:6:a9a43b844bc4"],
    "every luna call shares one prompt cache key",
  );

  const body = buildHypothesesComment({ report, runId: "codebot-test", version: "0.2.0" });
  assert.ok(body.includes(HYPOTHESES_MARKER));
  assert.ok(body.includes("Coordinator: `scripted:terra` ×2"));
  assert.ok(body.includes("Swarm: `scripted:luna` ×2"));
  assert.ok(body.includes("budget"));
  assert.ok(body.includes("dismiss with `npm run bot:learnings"));
});

test("a failed coordinator plan falls back to deterministic assignments", async () => {
  const coordinator = new ScriptedClient("scripted:terra", (call) => (call === 1 ? new Error("502 upstream") : SYNTHESIS_JSON));
  const luna = swarmClient();
  const report = await buildHypothesisReport({
    ...buildInput(),
    modelClient: coordinator,
    swarmClient: luna,
  });

  assert.ok(report.warnings.some((warning) => warning.includes("using the deterministic assignment plan")));
  assert.equal(report.usage.swarm.calls, 2, "the swarm still ran");
  assert.equal(report.totals.hypotheses, 1);
});

test("a failed synthesis keeps the swarm evidence and leads", async () => {
  const coordinator = new ScriptedClient("scripted:terra", (call) => (call === 1 ? PLAN_JSON : new Error("402 spend limit")));
  const luna = swarmClient();
  const report = await buildHypothesisReport({
    ...buildInput(),
    modelClient: coordinator,
    swarmClient: luna,
  });

  assert.ok(report.warnings.some((warning) => warning.includes("merged the available evidence deterministically")));
  assert.equal(report.totals.hypotheses, 1);
  const hypothesis = report.hypotheses[0];
  assert.equal(hypothesis.source, "model");
  assert.match(hypothesis.why, /pool connection for 30s/);
  assert.equal(hypothesis.ruleId, "threshold-change", "swarm findings inherit their lead");
});

test("a failing swarm agent is reported and the run still completes", async () => {
  const coordinator = new ScriptedClient("scripted:terra", (call) => (call === 1 ? PLAN_JSON : SYNTHESIS_JSON));
  const luna = new ScriptedClient("scripted:luna", () => new Error("tool budget gone"));
  const report = await buildHypothesisReport({
    ...buildInput(),
    modelClient: coordinator,
    swarmClient: luna,
  });

  assert.ok(report.warnings.some((warning) => warning.includes("swarm a1")));
  assert.equal(report.usage.swarm.calls, 0);
  assert.equal(report.usage.used, true, "the coordinator still counts as used");
  assert.equal(report.totals.hypotheses, 1, "the deterministic lead is kept");
});

test("the cost budget blocks new model calls and says so", async () => {
  const coordinator = new ScriptedClient("scripted:terra", (call) => (call === 1 ? PLAN_JSON : SYNTHESIS_JSON));
  const luna = swarmClient();
  const swarmConfig = { ...SWARM_CONFIG, maxCostUsd: 0.002 };
  const tracker = createCodeBotUsageTracker(swarmConfig);
  tracker.record("coordinator", { text: "", model: "seed", tokensIn: 0, tokensOut: 0, costUsd: 0.002, durationMs: 0 });
  const report = await buildHypothesisReport({
    ...buildInput({ swarmConfig, usageTracker: tracker }),
    modelClient: coordinator,
    swarmClient: luna,
  });

  assert.ok(report.warnings.some((warning) => warning.includes("cost budget")));
  assert.equal(coordinator.calls.length, 0, "the planner is blocked before the wire");
  assert.equal(luna.calls.length, 0, "swarm never started");
  assert.equal(report.usage.totalCostUsd, 0.002, "only the pre-existing spend is counted");
});

test("deterministic-only mode publishes leads without model usage", async () => {
  const report = await buildHypothesisReport({
    ...buildInput(),
    modelClient: null,
    swarmClient: null,
  });
  assert.equal(report.usage.used, false);
  assert.match(report.usage.reason ?? "", /CODEBOT_NO_MODEL/);
  assert.equal(report.totals.hypotheses, 1);
  const body = buildHypothesesComment({ report, runId: "codebot-test", version: "0.2.0" });
  assert.ok(body.includes("Model tiers skipped"));
});

test("a missing gateway key keeps the deterministic path", async () => {
  const report = await buildHypothesisReport({
    ...buildInput({ modelConfig: { ...MODEL_CONFIG, apiKey: "" } }),
    modelClient: undefined,
  });
  assert.equal(report.usage.used, false);
  assert.match(report.usage.reason ?? "", /no gateway key/);
});

test("dismissed fingerprints are suppressed and counted", async () => {
  const lead = scan([THRESHOLD_FILE], THRESHOLD_ANALYSES).hypotheses[0];
  assert.ok(lead);
  const dismissals: HypothesisDismissal[] = [
    {
      fingerprint: hypothesisId({ file: lead.file, line: lead.line, mechanism: lead.mechanism }),
      reason: "the pool is intentionally oversized",
      path: lead.file,
    },
  ];
  const report = await buildHypothesisReport({
    ...buildInput(),
    modelClient: null,
    swarmClient: null,
    dismissals,
  });
  assert.equal(report.totals.hypotheses, 0);
  assert.equal(report.dismissed, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("noise filter")));
  const body = buildHypothesesComment({ report, runId: "codebot-test", version: "0.2.0" });
  assert.ok(body.includes("1 dismissed hypothesis(es) suppressed"));
});

test("learnings are disabled with the environment kill-switch", async () => {
  const lead = scan([THRESHOLD_FILE], THRESHOLD_ANALYSES).hypotheses[0];
  assert.ok(lead);
  const report = await buildHypothesisReport({
    ...buildInput({ swarmConfig: { ...SWARM_CONFIG, learningsEnabled: false } }),
    modelClient: null,
    swarmClient: null,
    dismissals: [
      {
        fingerprint: hypothesisId({ file: lead.file, line: lead.line, mechanism: lead.mechanism }),
        reason: "dismissed",
      },
    ],
  });
  assert.equal(report.totals.hypotheses, 1);
  assert.equal(report.dismissed, 0);
});

test("renders an empty hypotheses comment without throwing", async () => {
  const report = await buildHypothesisReport({
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "a9a43b84",
    files: [{ path: "src/big.ts", status: "modified", additions: 9, deletions: 1 }],
    analyses: new Map(),
    index: null,
    modelClient: null,
    swarmClient: null,
  });
  const body = buildHypothesesComment({ report, runId: "codebot-empty", version: "0.2.0" });

  assert.equal(report.totals.hypotheses, 0);
  assert.ok(body.includes("No suspicious changes found in this diff."));
  assert.ok(body.includes("0 hypothesis(s)"));
});
