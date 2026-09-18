import assert from "node:assert/strict";
import test from "node:test";
import {
  dedupeHypotheses,
  mergeHypotheses,
  parseAssignments,
  sameFinding,
  parseModelHypotheses,
  renderGraphEvidence,
  runAssignmentPlanner,
  runSynthesis,
  toHypothesis,
  type ModelHypothesis,
} from "../src/master.ts";
import { parsePatches } from "../src/patch.ts";
import {
  coordinatorSystem,
  coordinatorPlanUser,
  coordinatorSynthesizeSystem,
  coordinatorSynthesizeUser,
  swarmSystem,
  swarmUser,
} from "../src/prompts.ts";
import {
  resolveCortardoBotModelConfig,
  resolveCortardoBotSwarmConfig,
  swarmModelConfig,
  type CortardoBotCompleteInput,
  type CortardoBotModelClient,
  type CortardoBotModelCompletion,
} from "../src/model.ts";
import type { CodegraphChangedFile, CodegraphReport, Hypothesis, SwarmAgentReport } from "../src/types.ts";

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

function entry(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file: "src/db.ts",
    line: 11,
    mechanism: "resource-leak",
    severity: "high",
    confidence: 0.7,
    change: "timeoutMs: 5_000 → 30_000",
    why: "the pool fills",
    question: "what bounds it?",
    ...overrides,
  };
}

test("accepts a valid model hypothesis and takes the snippet from the patch", () => {
  const result = parseModelHypotheses(JSON.stringify({ hypotheses: [entry()] }), {
    files: FILES,
    patches: PATCHES,
    maxHypotheses: 8,
  });
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.dropped, 0);
  assert.equal(result.hypotheses[0].line, 11);
  assert.equal(result.hypotheses[0].snippet, "  const timeoutMs = 30_000;");
});

test("snaps a line that is one or two lines off onto an added line", () => {
  const result = parseModelHypotheses(JSON.stringify({ hypotheses: [entry({ line: 13 })] }), {
    files: FILES,
    patches: PATCHES,
    maxHypotheses: 8,
  });
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.hypotheses[0].line, 11);
});

test("drops hallucinations and malformed entries", () => {
  const result = parseModelHypotheses(
    JSON.stringify({
      hypotheses: [
        entry({ file: "src/ghost.ts" }),
        entry({ line: 999 }),
        entry({ mechanism: "banana" }),
        entry({ why: "" }),
        entry({ file: 42 }),
      ],
    }),
    { files: FILES, patches: PATCHES, maxHypotheses: 8 },
  );
  assert.equal(result.hypotheses.length, 0);
  assert.equal(result.dropped, 5);
});

test("parses a fenced JSON answer and defaults severity and confidence", () => {
  const result = parseModelHypotheses(
    "```json\n" + JSON.stringify({ hypotheses: [entry({ severity: "unhinged", confidence: 9 })] }) + "\n```",
    { files: FILES, patches: PATCHES, maxHypotheses: 8 },
  );
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.hypotheses[0].severity, "medium");
  assert.equal(result.hypotheses[0].confidence, 0.5);
});

test("returns nothing for an unparseable answer", () => {
  const result = parseModelHypotheses("not json at all", { files: FILES, patches: PATCHES, maxHypotheses: 8 });
  assert.deepEqual(result.hypotheses, []);
  assert.equal(result.dropped, 0);
});

class ScriptedClient implements CortardoBotModelClient {
  readonly id = "scripted:master";
  readonly calls: CortardoBotCompleteInput[] = [];
  constructor(private readonly responses: string[]) {}
  async complete(input: CortardoBotCompleteInput): Promise<CortardoBotModelCompletion> {
    this.calls.push(input);
    const text = this.responses[Math.min(this.calls.length - 1, this.responses.length - 1)] ?? "";
    return { text, model: this.id, tokensIn: 10, tokensOut: 20, costUsd: 0.001, durationMs: 3 };
  }
}

function reportFixture(): CodegraphReport {
  return {
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "a9a43b844bc406a7db6266a338af8c1de09786fe",
    indexCommitSha: null,
    indexFileCount: 0,
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
        symbols: [{ id: "src/db.ts#withPool", name: "withPool", qualifiedName: "withPool", kind: "function", line: 10, endLine: 20, signature: "function withPool()", exported: true, parent: null }],
        imports: [],
        importedBy: ["src/orders.ts"],
        callers: [{ symbol: "getOrders", file: "src/orders.ts", via: "withPool" }],
        callees: [],
        tests: ["src/db.test.ts"],
      },
    ],
    unsupported: [],
    missingFromIndex: [],
    warnings: [],
    totals: { files: 1, indexed: 1, symbols: 1, callers: 1, tests: 1 },
  };
}

function leadFixture(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: "s_lead123",
    ruleId: "threshold-change",
    source: "rule",
    mechanism: "resource-leak",
    severity: "high",
    confidence: 0.6,
    file: "src/db.ts",
    line: 11,
    snippet: "  const timeoutMs = 30_000;",
    symbol: "withPool",
    change: "timeoutMs: 5_000 → 30_000",
    why: "rule why",
    question: "rule question",
    downstream: [{ symbol: "getOrders", file: "src/orders.ts", relation: "calls" }],
    ...overrides,
  };
}

function modelEntry(overrides: Partial<ModelHypothesis> = {}): ModelHypothesis {
  return {
    file: "src/db.ts",
    line: 11,
    snippet: "  const timeoutMs = 30_000;",
    mechanism: "resource-leak",
    severity: "high",
    confidence: 0.8,
    change: "timeoutMs: 5_000 → 30_000",
    why: "model why",
    question: "model question",
    downstream: [],
    ...overrides,
  };
}

test("mergeHypotheses lets synthesis win, keeps swarm evidence and covers leads", () => {
  const lead = leadFixture();
  const unmatchedLead = leadFixture({
    id: "s_ttl456",
    mechanism: "stale-state",
    line: 12,
    change: "cache ttl reduced",
  });
  const swarm = [toHypothesis(modelEntry({ why: "swarm why" }), lead)];
  const synthesis = [
    toHypothesis(modelEntry({ why: "synthesis why" }), lead),
    toHypothesis(modelEntry({ mechanism: "crash", why: "synthesis crash", change: "removed a null guard" })),
  ];

  const merged = mergeHypotheses({
    leads: [lead, unmatchedLead],
    swarm,
    synthesis,
    maxHypotheses: 8,
  });

  assert.equal(merged.length, 3);
  const refined = merged.find((hypothesis) => hypothesis.mechanism === "resource-leak");
  assert.ok(refined);
  assert.equal(refined.ruleId, "threshold-change", "synthesis keeps the lead it refines");
  assert.equal(refined.why, "synthesis why", "synthesis overrides the swarm finding for the same key");
  const crash = merged.find((hypothesis) => hypothesis.mechanism === "crash");
  assert.ok(crash);
  assert.equal(crash.source, "model");
  assert.ok(merged.some((hypothesis) => hypothesis.id === "s_ttl456"), "unmatched leads survive");
});

test("parseAssignments filters unknown files and leads and drops empty assignments", () => {
  const leads = [leadFixture()];
  const result = parseAssignments(
    JSON.stringify({
      assignments: [
        { id: "a1", kind: "lead", files: ["src/db.ts"], leads: [leads[0].id], focus: "check the timeout" },
        { id: "a2", files: ["src/ghost.ts"], focus: "ghost" },
        { id: "a3", files: ["src/db.ts"], leads: [], focus: "" },
        { id: "a4", files: ["src/db.ts"], leads: ["s_nope"], focus: "sweep it" },
      ],
    }),
    { changedFiles: ["src/db.ts"], leads, maxAgents: 6 },
  );
  assert.equal(result.assignments.length, 2);
  assert.equal(result.dropped, 2);
  assert.deepEqual(result.assignments[0].leads, [leads[0].id]);
  assert.equal(result.assignments[0].kind, "lead");
  assert.equal(result.assignments[1].kind, "sweep");
  assert.deepEqual(result.assignments[1].leads, []);
});

test("runAssignmentPlanner sends the diff and parses the plan", async () => {
  const client = new ScriptedClient([
    JSON.stringify({ assignments: [{ id: "a1", kind: "lead", files: ["src/db.ts"], leads: ["s_lead123"], focus: "verify the timeout" }] }),
  ]);
  const result = await runAssignmentPlanner({
    repository: "acme/app",
    pullRequestNumber: 6,
    title: "raise timeouts",
    headSha: "a9a43b844bc406a7db6266a338af8c1de09786fe",
    report: reportFixture(),
    files: FILES,
    leads: [leadFixture()],
    dismissals: [],
    maxAgents: 6,
    client,
  });
  assert.equal(result.assignments.length, 1);
  assert.equal(result.assignments[0].focus, "verify the timeout");
  assert.ok(client.calls[0].user.includes("> 11|   const timeoutMs = 30_000;"));
  assert.ok(client.calls[0].user.includes("leadId s_lead123"));
});

function reportFixtureForSwarm(): SwarmAgentReport {
  return {
    assignmentId: "a1",
    hypotheses: [toHypothesis(modelEntry({ why: "swarm why" }), leadFixture())],
    checked: ["src/db.ts:11"],
    dropped: 0,
    toolCalls: 4,
    turns: 2,
    stoppedReason: "final answer",
  };
}

test("runSynthesis validates the synthesis and reports drops", async () => {
  const client = new ScriptedClient([
    JSON.stringify({ hypotheses: [entry({ why: "synthesis why" }), entry({ file: "src/ghost.ts" })] }),
  ]);
  const result = await runSynthesis({
    repository: "acme/app",
    pullRequestNumber: 6,
    title: "raise timeouts",
    headSha: "a9a43b844bc406a7db6266a338af8c1de09786fe",
    leads: [leadFixture()],
    reports: [reportFixtureForSwarm()],
    dismissals: [],
    maxHypotheses: 8,
    files: FILES,
    patches: PATCHES,
    client,
  });
  assert.equal(result.entries.length, 1);
  assert.equal(result.dropped, 1);
  assert.ok(client.calls[0].user.includes("swarm why"));
  assert.ok(result.warnings.some((warning) => warning.includes("dropped 1")));
});

test("resolves the coordinator and swarm models with env overrides", () => {
  const defaults = resolveCortardoBotModelConfig({});
  assert.equal(defaults.model, "openai/gpt-5.6-terra");
  assert.equal(defaults.swarmModel, "openai/gpt-5.6-luna");
  assert.equal(defaults.reasoning, "medium");

  const overridden = resolveCortardoBotModelConfig({
    CORTARDO_BOT_MODEL: "openai/custom-coordinator",
    CORTARDO_BOT_SWARM_MODEL: "openai/custom-swarm",
    CORTADO_AI_API_KEY: "secret",
    CORTARDO_BOT_REASONING: "high",
  });
  assert.equal(overridden.model, "openai/custom-coordinator");
  assert.equal(overridden.swarmModel, "openai/custom-swarm");
  assert.equal(overridden.apiKey, "secret");
  assert.equal(overridden.reasoning, "high");

  const swarmClient = swarmModelConfig(overridden);
  assert.equal(swarmClient.model, "openai/custom-swarm");
  assert.equal(swarmClient.swarmModel, "openai/custom-swarm");

  const explicit = resolveCortardoBotModelConfig({ CORTARDO_BOT_API_KEY: "override", CORTADO_AI_API_KEY: "shared" });
  assert.equal(explicit.apiKey, "override", "CORTARDO_BOT_API_KEY wins so an exhausted key can be swapped");
});

test("resolves swarm and budget settings with env overrides", () => {
  const defaults = resolveCortardoBotSwarmConfig({});
  assert.equal(defaults.maxAgents, 6);
  assert.equal(defaults.concurrency, 3);
  assert.equal(defaults.maxCostUsd, 0.5);
  assert.equal(defaults.targetCostUsd, 0.4);
  assert.equal(defaults.reserveUsd, 0.15);
  assert.equal(defaults.maxTurns, 3);
  assert.equal(defaults.codegenTurns, 2);
  assert.equal(defaults.searchEnabled, true);
  assert.equal(defaults.learningsEnabled, true);
  assert.deepEqual(defaults.fixSeverities, ["critical", "high"]);
  assert.equal(defaults.verifyEnabled, true);
  assert.equal(defaults.verifyAttempts, 4);
  assert.equal(defaults.e2bTemplate, "cortardo-review-v1");

  const overridden = resolveCortardoBotSwarmConfig({
    CORTARDO_BOT_SWARM_AGENTS: "4",
    CORTARDO_BOT_SWARM_CONCURRENCY: "2",
    CORTARDO_BOT_MAX_COST_USD: "0.15",
    CORTARDO_BOT_SWARM_TURNS: "5",
    CORTARDO_BOT_SWARM_TOOLS: "2",
    CORTARDO_BOT_SWARM_SEARCH: "0",
    CORTARDO_BOT_LEARNINGS: "0",
  });
  assert.equal(overridden.maxAgents, 4);
  assert.equal(overridden.concurrency, 2);
  assert.equal(overridden.maxCostUsd, 0.15);
  assert.equal(overridden.maxTurns, 5);
  assert.equal(overridden.maxToolsPerTurn, 2);
  assert.equal(overridden.searchEnabled, false);
  assert.equal(overridden.learningsEnabled, false);
});

test("renders graph evidence with callers, importers and tests", () => {
  const graph = renderGraphEvidence(reportFixture());
  assert.ok(graph.includes("src/db.ts (modified, TypeScript)"));
  assert.ok(graph.includes("callers outside the diff: src/orders.ts#getOrders → withPool"));
  assert.ok(graph.includes("imported by: src/orders.ts"));
  assert.ok(graph.includes("likely tests: src/db.test.ts"));
});

test("coordinator and swarm prompts carry the diff, leads and vocabulary", () => {
  const planSystem = coordinatorSystem();
  assert.ok(planSystem.includes("code-review investigation"));
  assert.ok(planSystem.includes("resource-leak"));

  const planUser = coordinatorPlanUser({
    repository: "acme/app",
    pullRequestNumber: 6,
    title: "raise timeouts",
    headSha: "a9a43b84",
    diff: "> 11|   const timeoutMs = 30_000;",
    graph: "callers outside the diff: src/orders.ts#getOrders",
    leads: [leadFixture()],
    dismissals: [],
    maxAgents: 6,
  });
  assert.ok(planUser.includes("raise timeouts"));
  assert.ok(planUser.includes("leadId s_lead123"));
  assert.ok(planUser.includes("callers outside the diff"));

  const swarmPrompt = swarmSystem();
  assert.ok(swarmPrompt.includes("read-only tools"));
  assert.ok(swarmPrompt.includes("resource-leak"));
  assert.ok(swarmPrompt.includes("Never invent"));

  const swarmAssignment = swarmUser({
    repository: "acme/app",
    pullRequestNumber: 6,
    title: "raise timeouts",
    headSha: "a9a43b84",
    assignment: { id: "a1", kind: "lead", files: ["src/db.ts"], leads: ["s_lead123"], focus: "verify the timeout" },
    fileDiffs: "> 11|   const timeoutMs = 30_000;",
    graphEvidence: "callers outside the diff: src/orders.ts#getOrders",
    leads: [leadFixture()],
    dismissals: [],
  });
  assert.ok(swarmAssignment.includes("verify the timeout"));
  assert.ok(swarmAssignment.includes("Files in scope"));
  assert.ok(swarmAssignment.includes("Start with a tool call now"));

  const synthesisSystem = coordinatorSynthesizeSystem();
  assert.equal(synthesisSystem, coordinatorSystem(), "plan and synthesis share one cacheable system prompt");
  const synthesisUser = coordinatorSynthesizeUser({
    repository: "acme/app",
    pullRequestNumber: 6,
    title: "raise timeouts",
    headSha: "a9a43b84",
    leads: [leadFixture()],
    reports: [reportFixtureForSwarm()],
    dismissals: [],
    maxHypotheses: 8,
    diff: "> 11|   const timeoutMs = 30_000;",
  });
  assert.ok(synthesisUser.includes("at most 8"));
  assert.ok(synthesisUser.includes("swarm why"));
  assert.ok(synthesisUser.includes("Investigator reports"));
});

test("sameFinding collapses same-line overlapping findings and keeps distinct ones", () => {
  const resource = leadFixture({
    id: "s_a",
    mechanism: "resource-leak",
    change: "timeoutMs: 5_000 → 30_000",
    why: "callers hold a pool connection for 30 seconds under load",
    priority: undefined,
  });
  const sameWordingOtherMechanism = leadFixture({
    id: "s_b",
    mechanism: "wrong-value",
    change: "the pool timeout increased from 5s to 30s",
    why: "a held pool connection now lasts 30 seconds under load",
    priority: undefined,
  });
  assert.equal(sameFinding(resource, sameWordingOtherMechanism), true, "overlapping wording on the same line is a duplicate");

  const truncation = leadFixture({
    id: "s_c",
    mechanism: "wrong-value",
    change: "the session value for a newly created API key is truncated to its first ten characters",
    why: "any subsequent flow that retrieves ag_fresh_key receives an unusable credential fragment",
  });
  const emptyCatch = leadFixture({
    id: "s_d",
    mechanism: "swallowed-error",
    change: "added an empty catch block",
    why: "the failure is discarded so callers cannot distinguish success from failure",
  });
  assert.equal(sameFinding(truncation, emptyCatch), false, "genuinely different defects on one line stay separate");

  const nearby = leadFixture({ id: "s_e", line: 13, mechanism: "resource-leak" });
  assert.equal(sameFinding(resource, nearby), true, "same mechanism a few lines away is a duplicate");
});

test("dedupeHypotheses reports the merged count and unions downstream refs", () => {
  const a = leadFixture({
    id: "s_1",
    priority: undefined,
    why: "callers hold a pool connection for 30 seconds under load",
    downstream: [{ symbol: "getOrders", file: "src/orders.ts", relation: "calls" }],
  });
  const b = leadFixture({
    id: "s_2",
    priority: undefined,
    change: "the pool timeout increased from 5s to 30s",
    why: "a held pool connection now lasts 30 seconds under load",
    mechanism: "wrong-value",
    downstream: [{ symbol: "getReport", file: "src/reports.ts", relation: "calls" }],
  });
  const result = dedupeHypotheses([a, b]);
  assert.equal(result.hypotheses.length, 1);
  assert.equal(result.deduped, 1);
  assert.equal(result.hypotheses[0].downstream.length, 2, "both downstream refs survive the merge");
});

test("mergeHypotheses orders by coordinator priority before severity", () => {
  const important = leadFixture({ id: "s_low_severity", severity: "medium", priority: 1 });
  const severe = leadFixture({ id: "s_critical", severity: "critical", line: 30, mechanism: "stale-state", change: "cache ttl reduced" });
  const merged = mergeHypotheses({ leads: [severe, important], swarm: [], synthesis: [], maxHypotheses: 8 });
  assert.equal(merged[0].id, "s_low_severity", "priority 1 wins over a more severe unranked finding");
});
