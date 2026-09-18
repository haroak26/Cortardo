import assert from "node:assert/strict";
import test from "node:test";
import { executeReadTool, READ_TOOL_NAMES, type ReadToolContext } from "../src/tools.ts";
import { runAgent } from "../src/agent.ts";
import { fallbackAssignments, runSwarm, withCoverage } from "../src/swarm.ts";
import { parsePatches } from "../src/patch.ts";
import type { BetabotCompleteInput, BetabotModelClient, BetabotModelCompletion, BetabotSwarmConfig } from "../src/model.ts";
import type {
  CodegraphChangedFile,
  CodegraphReport,
  Hypothesis,
  RepoGraphIndex,
  SwarmAssignment,
} from "../src/types.ts";

const FILES: CodegraphChangedFile[] = [
  {
    path: "src/db.ts",
    status: "modified",
    additions: 1,
    deletions: 1,
    patch: ["@@ -10,4 +10,4 @@", " export function withPool() {", "-  const timeoutMs = 5_000;", "+  const timeoutMs = 30_000;", " }"].join("\n"),
  },
  {
    path: "src/cart.ts",
    status: "modified",
    additions: 2,
    deletions: 1,
    patch: ["@@ -1,2 +1,3 @@", " const total = 0;", "-const tax = 0.1;", "+const tax = 0.2;", "+const shipping = 0;"].join("\n"),
  },
  { path: "README.md", status: "modified", additions: 1, deletions: 0, patch: "@@ -1,1 +1,2 @@\n+hello" },
];

const INDEX: RepoGraphIndex = {
  commitSha: "3f7d3774",
  files: [
    { id: "src/db.ts", path: "src/db.ts", language: "TypeScript", kind: "source", loc: 40 },
    { id: "src/cart.ts", path: "src/cart.ts", language: "TypeScript", kind: "source", loc: 20 },
  ],
  connections: [],
  symbols: [],
  symbolEdges: [],
};

const REPORT: CodegraphReport = {
  repository: "acme/app",
  pullRequestNumber: 7,
  headSha: "74c5449d",
  indexCommitSha: "3f7d3774",
  indexFileCount: 2,
  files: [
    {
      path: "src/db.ts",
      status: "modified",
      additions: 1,
      deletions: 1,
      language: "TypeScript",
      kind: "source",
      loc: 40,
      indexed: true,
      symbols: [],
      imports: [],
      importedBy: [],
      callers: [],
      callees: [],
      tests: [],
    },
  ],
  unsupported: [],
  missingFromIndex: [],
  warnings: [],
  totals: { files: 1, indexed: 1, symbols: 0, callers: 0, tests: 0 },
};

const CONFIG: BetabotSwarmConfig = {
  maxAgents: 6,
  concurrency: 2,
  maxTurns: 3,
  maxToolsPerTurn: 2,
  maxCostUsd: 0.3,
  timeoutMs: 30_000,
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

function lead(id: string, file: string, overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id,
    ruleId: "threshold-change",
    source: "rule",
    mechanism: "resource-leak",
    severity: "high",
    confidence: 0.6,
    file,
    line: 11,
    snippet: "  const timeoutMs = 30_000;",
    change: `change in ${file}`,
    why: "why",
    question: "question",
    downstream: [],
    ...overrides,
  };
}

test("fallbackAssignments clusters leads by file and sweeps uncovered files", () => {
  const assignments = fallbackAssignments({
    files: FILES,
    leads: [lead("s_a", "src/db.ts"), lead("s_b", "src/db.ts"), lead("s_c", "src/cart.ts")],
    maxAgents: 6,
  });
  assert.equal(assignments.length, 2);
  assert.deepEqual(assignments[0].leads, ["s_a", "s_b"]);
  assert.equal(assignments[0].kind, "lead");
  assert.deepEqual(assignments[1].files, ["src/cart.ts"]);
  assert.ok(assignments.every((assignment) => !assignment.files.includes("README.md")));
});

test("fallbackAssignments groups uncovered files into one module sweep", () => {
  const assignments = fallbackAssignments({ files: FILES, leads: [], maxAgents: 6 });
  assert.equal(assignments.length, 1, "both files live in src/, so one agent covers them");
  assert.deepEqual(assignments[0].files, ["src/cart.ts", "src/db.ts"]);
  assert.equal(assignments[0].kind, "sweep");
  assert.ok(!assignments.some((assignment) => assignment.files.includes("README.md")));
});

test("withCoverage appends sweeps for files the coordinator forgot", () => {
  const planned: SwarmAssignment[] = [
    { id: "a1", kind: "lead", files: ["src/db.ts"], leads: ["s_a"], focus: "verify" },
  ];
  const covered = withCoverage({ assignments: planned, files: FILES, maxAgents: 6 });
  assert.equal(covered.length, 2);
  assert.deepEqual(covered[1].files, ["src/cart.ts"]);
});

test("withCoverage respects the agent cap", () => {
  const planned: SwarmAssignment[] = [];
  const covered = withCoverage({ assignments: planned, files: FILES, maxAgents: 1 });
  assert.equal(covered.length, 1);
});

class ToolThenFinalClient implements BetabotModelClient {
  readonly id = "scripted:swarm";
  readonly calls: BetabotCompleteInput[] = [];
  constructor(private readonly plan: Array<Record<string, unknown>>) {}
  async complete(input: BetabotCompleteInput): Promise<BetabotModelCompletion> {
    this.calls.push(input);
    const response = this.plan[Math.min(this.calls.length - 1, this.plan.length - 1)] ?? {};
    return { text: JSON.stringify(response), model: this.id, tokensIn: 30, tokensOut: 15, costUsd: 0.0005, durationMs: 2 };
  }
}

test("runSwarm reads with tools and maps the agent's final hypotheses", async () => {
  const client = new ToolThenFinalClient([
    { thought: "look", actions: [{ tool: "read_file", args: { path: "src/db.ts" } }], done: false },
    {
      hypotheses: [
        {
          file: "src/db.ts",
          line: 11,
          mechanism: "resource-leak",
          severity: "high",
          confidence: 0.8,
          change: "timeoutMs: 5_000 → 30_000",
          why: "pool fills",
          question: "what bounds it?",
        },
      ],
    },
  ]);
  const reports = await runSwarm({
    repository: "acme/app",
    pullRequestNumber: 7,
    title: "raise timeouts",
    headSha: "74c5449d",
    installationId: 1,
    fullName: "acme/app",
    files: FILES,
    patches: parsePatches(FILES),
    analyses: new Map(),
    report: REPORT,
    index: INDEX,
    leads: [lead("s_a", "src/db.ts")],
    dismissals: [],
    assignments: [{ id: "a1", kind: "lead", files: ["src/db.ts"], leads: ["s_a"], focus: "verify" }],
    client,
    config: CONFIG,
    deadline: Date.now() + 5_000,
    readFile: async (path) => (path === "src/db.ts" ? "export const timeoutMs = 30_000;\n" : undefined),
  });

  assert.equal(reports.length, 1);
  assert.equal(reports[0].failure, undefined);
  assert.equal(reports[0].hypotheses.length, 1);
  assert.equal(reports[0].hypotheses[0].source, "model");
  assert.equal(reports[0].hypotheses[0].ruleId, "threshold-change", "the matching lead is inherited");
  assert.ok(reports[0].toolCalls >= 1);
  assert.ok(client.calls[0].user.includes("Your assignment"));
});

test("runSwarm isolates a failing agent and keeps the others", async () => {
  let calls = 0;
  const client: BetabotModelClient = {
    id: "scripted:failing",
    async complete(): Promise<BetabotModelCompletion> {
      calls += 1;
      if (calls === 1) throw new Error("502 upstream");
      return {
        text: JSON.stringify({ hypotheses: [] }),
        model: "scripted:failing",
        tokensIn: 1,
        tokensOut: 1,
        durationMs: 1,
      };
    },
  };
  const reports = await runSwarm({
    repository: "acme/app",
    pullRequestNumber: 7,
    title: "raise timeouts",
    headSha: "74c5449d",
    installationId: 1,
    fullName: "acme/app",
    files: FILES,
    patches: parsePatches(FILES),
    analyses: new Map(),
    report: REPORT,
    index: INDEX,
    leads: [],
    dismissals: [],
    assignments: [
      { id: "a1", kind: "sweep", files: ["src/db.ts"], leads: [], focus: "one" },
      { id: "a2", kind: "sweep", files: ["src/cart.ts"], leads: [], focus: "two" },
    ],
    client,
    config: { ...CONFIG, concurrency: 1 },
    deadline: Date.now() + 5_000,
    readFile: async () => "const x = 1;\n",
  });

  assert.equal(reports.length, 2);
  assert.equal(reports.filter((report) => report.failure).length, 1);
  assert.equal(reports.filter((report) => report.failure === undefined).length, 1);
});

test("runSwarm skips assignments when the budget is exhausted", async () => {
  const client = new ToolThenFinalClient([{ hypotheses: [] }]);
  const reports = await runSwarm({
    repository: "acme/app",
    pullRequestNumber: 7,
    title: "raise timeouts",
    headSha: "74c5449d",
    installationId: 1,
    fullName: "acme/app",
    files: FILES,
    patches: parsePatches(FILES),
    analyses: new Map(),
    report: REPORT,
    index: INDEX,
    leads: [],
    dismissals: [],
    assignments: [{ id: "a1", kind: "sweep", files: ["src/db.ts"], leads: [], focus: "one" }],
    client,
    config: CONFIG,
    deadline: Date.now() + 5_000,
    budgetExhausted: () => true,
    readFile: async () => "const x = 1;\n",
  });
  assert.equal(reports[0].failure, "model cost budget exhausted before this assignment started");
  assert.equal(client.calls.length, 0);
});

test("runAgent rejects an empty final answer until a tool has run", async () => {
  const client = new ToolThenFinalClient([
    { hypotheses: [] },
    { thought: "read", actions: [{ tool: "read_file", args: { path: "src/db.ts" } }], done: false },
    { hypotheses: [{ file: "src/db.ts", line: 11, mechanism: "resource-leak" }] },
  ]);
  const result = await runAgent({
    system: "system",
    user: "user",
    tools: READ_TOOL_NAMES,
    execute: async (action) => ({ tool: action.tool, ok: true, summary: "read", detail: "content" }),
    client,
    maxTurns: 4,
    maxToolsPerTurn: 2,
    deadline: Date.now() + 5_000,
    minToolCallsBeforeFinal: 1,
    label: "test",
  });
  assert.equal(result.stoppedReason, "final answer");
  assert.equal(result.toolCalls, 1);
  assert.ok(client.calls.length >= 3, "the first final answer is pushed back");
});

test("runAgent grounds a lazy model by reading the first file for it", async () => {
  const client = new ToolThenFinalClient([{ hypotheses: [] }, { hypotheses: [] }]);
  const executed: string[] = [];
  const result = await runAgent({
    system: "system",
    user: "user",
    tools: READ_TOOL_NAMES,
    execute: async (action) => {
      executed.push(action.tool);
      return { tool: action.tool, ok: true, summary: "diff", detail: "> 11| const x = 1;" };
    },
    client,
    maxTurns: 4,
    maxToolsPerTurn: 2,
    deadline: Date.now() + 5_000,
    minToolCallsBeforeFinal: 1,
    groundingAction: { tool: "read_diff", args: { path: "src/db.ts" } },
    label: "test",
  });
  assert.deepEqual(executed, ["read_diff"]);
  assert.equal(result.toolCalls, 1);
  assert.equal(client.calls.length, 3, "two empty answers are pushed back before acceptance");
  assert.equal(result.stoppedReason, "final answer");
});

test("read tools serve the diff, graph and repository search", async () => {
  const emptyAnalyses = new Map();
  const context: ReadToolContext = {
    fullName: "acme/app",
    headSha: "74c5449d",
    patches: parsePatches(FILES),
    analyses: emptyAnalyses,
    report: REPORT,
    repoFiles: ["src/db.ts", "src/cart.ts", "README.md"],
    readFile: async (path) => (path === "src/db.ts" ? "line one\nline two\n" : undefined),
    searchCode: async (query) => [{ path: "src/db.ts", fragments: [`const x = ${query}`] }],
  };

  const diff = await executeReadTool({ tool: "read_diff", args: { path: "src/db.ts" } }, context);
  assert.equal(diff.ok, true);
  assert.ok(diff.detail.includes("> 11|   const timeoutMs = 30_000;"));

  const impact = await executeReadTool({ tool: "get_impact", args: { path: "src/db.ts" } }, context);
  assert.equal(impact.ok, true);

  const found = await executeReadTool({ tool: "find_files", args: { glob: "src/*.ts" } }, context);
  assert.equal(found.ok, true);
  assert.ok(found.detail.includes("src/cart.ts"));

  const search = await executeReadTool({ tool: "search_code", args: { query: "timeoutMs" } }, context);
  assert.equal(search.ok, true);
  assert.ok(search.detail.includes("src/db.ts"));

  const read = await executeReadTool({ tool: "read_file", args: { path: "src/db.ts", start: 2, end: 2 } }, context);
  assert.equal(read.ok, true);
  assert.ok(read.detail.startsWith("2| line two"));

  const missing = await executeReadTool({ tool: "read_diff", args: { path: "src/not-changed.ts" } }, context);
  assert.equal(missing.ok, false);

  const unknown = await executeReadTool({ tool: "run_command", args: {} }, context);
  assert.equal(unknown.ok, false);
  assert.ok(unknown.detail.includes("Allowed tools"));
});

test("search_code degrades when the repository search is unavailable", async () => {
  const context: ReadToolContext = {
    fullName: "acme/app",
    headSha: "74c5449d",
    patches: parsePatches(FILES),
    analyses: new Map(),
    report: REPORT,
    repoFiles: ["src/db.ts"],
    readFile: async (path) => (path === "src/db.ts" ? "const timeoutMs = 30_000;\n" : undefined),
    searchCode: async () => {
      throw new Error("rate limited");
    },
  };
  const result = await executeReadTool({ tool: "search_code", args: { query: "timeoutMs" } }, context);
  assert.equal(result.ok, false);
  assert.ok(result.detail.includes("rate limited"));
  assert.ok(result.summary.includes("unavailable"));

  const fallback = await executeReadTool({ tool: "search_code", args: { query: "timeoutMs" } }, { ...context, searchCode: undefined });
  assert.equal(fallback.ok, true);
  assert.ok(fallback.detail.includes("src/db.ts:1"));
});
