import assert from "node:assert/strict";
import { test } from "node:test";
import { runSwarmAgent } from "../../src/v3/swarm-agent.ts";
import { runSwarm } from "../../src/v3/swarm.ts";
import { buildSwarmContext } from "../../src/v3/agent/context-pack.ts";
import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import { ModelRouter } from "../../src/v3/models.ts";
import { resolveV3Config } from "../../src/v3/config.ts";
import { contextWith, scriptedClient, silentLogger, type ScriptedClient } from "./helpers.ts";
import type { PRContext, ReviewRequest } from "../../src/v3/types.ts";

const DOCS = "client/src/pages/Docs.tsx";
const PRICING = "client/src/pages/Pricing.tsx";
const DOCS_CONTENT = "import { useState } from \"react\";\n\nexport default function Docs() {\n  const [tab] = useState(\"install\");\n  const undefinedValue = undefined as any;\n  console.log(undefinedValue.property.nested.value);\n\n  return (\n    <div>\n      <h1>Docs</h1>\n      <p>{tab}</p>\n    </div>\n  );\n}\n";
const PRICING_CONTENT = "const tiers = [\"Free\", \"Max\", \"Enterprise\"];\n\nexport default function Pricing() {\n  return <div>{tiers.filter((_, i) => i !== 1).map((tier) => <span key={tier}>{tier}</span>)}</div>;\n}\n";

const AGENT = { id: "luna-bug", kind: "bug" as const, title: "Bug investigator", focus: "logic errors" };

function files(): Record<string, string> {
  return { [DOCS]: DOCS_CONTENT, [PRICING]: PRICING_CONTENT };
}

function sandbox(): MemorySandbox {
  return new MemorySandbox({
    files: files(),
    profile: { testCommand: "npm test --silent", typecheckCommand: "npm run check --silent" },
    execHandler: () => ({ exitCode: 0, stdout: "" }),
  });
}

function context(): PRContext {
  return contextWith(
    [
      { path: DOCS, content: DOCS_CONTENT },
      { path: PRICING, content: PRICING_CONTENT },
    ],
    { classification: ["UI"], riskSignals: ["deterministic detector: undefined dereference"] },
  );
}

function request(): ReviewRequest {
  return {
    runId: "run-swarm-agent-test",
    repo: { fullName: "o/r", defaultBranch: "main", installationId: 1, cloneUrl: "x", token: "x" },
    pr: { number: 6, title: "New pricing page", body: "", baseSha: "base", headSha: "head", baseBranch: "main", headBranch: "feature" },
    files: [],
  };
}

function lunaWith(script: string[]): ScriptedClient {
  return scriptedClient("luna", (_task, index) => script[Math.min(index, script.length - 1)]!);
}

function router(luna: ScriptedClient): ModelRouter {
  const config = resolveV3Config({ mode: "dry" }).models;
  const terra = scriptedClient("terra", () => JSON.stringify({ decisions: [] }));
  const astra = scriptedClient("astra", () => JSON.stringify({ reviews: [] }));
  return new ModelRouter({ clients: { luna, terra, astra }, config, maxCalls: 40 });
}

async function agentDeps(script: string[], overrides: { deadline?: number; maxTurns?: number } = {}) {
  const box = sandbox();
  const ctx = context();
  const profile = await box.profile();
  const pack = await buildSwarmContext({ context: ctx, sandbox: box, profile });
  const luna = lunaWith(script);
  return {
    luna,
    sandbox: box,
    context: ctx,
    pack,
    deps: {
      agent: AGENT,
      context: ctx,
      request: request(),
      detectorClaims: "- client/src/pages/Docs.tsx:6: undefined dereference",
      models: router(luna),
      logger: silentLogger,
      sandbox: box,
      profile,
      pack,
      deadline: overrides.deadline ?? Date.now() + 60_000,
      maxTurns: overrides.maxTurns ?? 3,
      maxToolsPerTurn: 3,
    },
  };
}

test("agentic investigator explores with read-only tools then reports", async () => {
  const { luna, deps } = await agentDeps([
    JSON.stringify({ thought: "read the file", actions: [{ tool: "read_file", args: { path: DOCS } }] }),
    JSON.stringify({
      hypotheses: [{ claim: "Docs page dereferences an explicitly undefined value during render", evidence: [`${DOCS}:6`], severity: "critical", confidence: 0.9 }],
    }),
  ]);
  const outcome = await runSwarmAgent(deps);
  assert.equal(outcome.report.status, "completed");
  assert.equal(outcome.report.turns, 2);
  assert.equal(outcome.report.toolCalls, 1);
  assert.equal(outcome.report.hypotheses, 1);
  assert.equal(outcome.candidates.length, 1);
  assert.equal(outcome.candidates[0].file, DOCS);
  assert.equal(outcome.candidates[0].line, 6);
  assert.equal(outcome.candidates[0].source, "luna");
  assert.ok(outcome.candidates[0].check, "client render crash infers a browser check");
  assert.ok(outcome.report.transcript && outcome.report.transcript.turns.length === 1);
  assert.ok((luna.calls[1].history ?? []).length > 0, "second call saw the first turn history");
});

test("investigators cannot mutate the repository (read-only enforcement)", async () => {
  const { luna, sandbox: box, deps } = await agentDeps([
    JSON.stringify({ thought: "patch it", actions: [{ tool: "apply_edit", args: { edits: [{ path: DOCS, find: "undefinedValue", replace: "safeValue" }] } }] }),
    JSON.stringify({ hypotheses: [] }),
  ]);
  const before = await box.read(DOCS);
  const outcome = await runSwarmAgent(deps);
  const after = await box.read(DOCS);
  assert.equal(after, before, "the file must never change");
  assert.equal(outcome.report.status, "completed");
  assert.equal(outcome.report.hypotheses, 0);
  const followUp = `${luna.calls[1].user}\n${JSON.stringify((luna.calls[1].history ?? []).map((message) => message.content))}`;
  assert.match(followUp, /not available to investigators/);
  assert.match(followUp, /read-only/);
});

test("hypotheses with unresolvable evidence are dropped without failing the agent", async () => {
  const { deps } = await agentDeps([
    JSON.stringify({
      hypotheses: [{ claim: "unrelated file has a bug that is not part of this diff at all", evidence: ["server/src/other.ts:3"], severity: "high", confidence: 0.8 }],
    }),
  ]);
  const outcome = await runSwarmAgent(deps);
  assert.equal(outcome.report.hypotheses, 1);
  assert.equal(outcome.report.candidates, 0);
  assert.equal(outcome.candidates.length, 0);
  assert.equal(outcome.report.status, "completed");
});

test("a finished agent is accepted without a forced extra call", async () => {
  const { luna, deps } = await agentDeps([JSON.stringify({ thought: "done", done: true, summary: "nothing to add" })]);
  const outcome = await runSwarmAgent(deps);
  assert.equal(outcome.report.status, "completed");
  assert.equal(outcome.report.hypotheses, 0);
  assert.equal(luna.calls.length, 1);
});

test("an exhausted turn budget forces one final answer turn", async () => {
  const { luna, deps } = await agentDeps(
    [
      JSON.stringify({ thought: "keep reading", actions: [{ tool: "read_file", args: { path: PRICING } }] }),
      JSON.stringify({
        hypotheses: [{ claim: "Pricing filter removes the featured tier from render", evidence: [`${PRICING}:4`], severity: "high", confidence: 0.85 }],
      }),
    ],
    { maxTurns: 1 },
  );
  const outcome = await runSwarmAgent(deps);
  assert.equal(outcome.report.status, "completed");
  assert.equal(outcome.report.turns, 2);
  assert.equal(outcome.report.hypotheses, 1);
  assert.equal(outcome.candidates.length, 1);
  assert.equal(luna.calls.length, 2);
  assert.match(luna.calls[1].user, /Investigation turns are over/);
});

test("an exhausted deadline marks the agent budget-limited without a model call", async () => {
  const { luna, deps } = await agentDeps([JSON.stringify({ hypotheses: [] })], { deadline: Date.now() - 1 });
  const outcome = await runSwarmAgent(deps);
  assert.equal(outcome.report.status, "budget");
  assert.equal(outcome.report.turns, 0);
  assert.equal(luna.calls.length, 0);
});

test("runSwarm is agentic with a context pack and falls back to single-shot without one", async () => {
  const script = [
    JSON.stringify({
      hypotheses: [{ claim: "Docs page dereferences an undefined value at render time", evidence: [`${DOCS}:6`], severity: "critical", confidence: 0.9 }],
    }),
  ];
  const box = sandbox();
  const ctx = context();
  const profile = await box.profile();
  const pack = await buildSwarmContext({ context: ctx, sandbox: box, profile });

  const agentic = await runSwarm(ctx, request(), [], router(lunaWith(script)), silentLogger, 60_000, { sandbox: box, profile, pack, maxTurns: 2, maxToolsPerTurn: 2 });
  assert.equal(agentic.report.mode, "agentic");
  assert.equal(agentic.report.agents.length, 4);
  assert.equal(agentic.report.hypotheses, 4);
  assert.ok(agentic.candidates.every((candidate) => candidate.source === "luna"));

  const singleShotRouter = router(lunaWith(script));
  const singleShot = await runSwarm(ctx, request(), [], singleShotRouter, silentLogger, 60_000);
  assert.equal(singleShot.report.mode, "single-shot");
  assert.equal(singleShot.report.agents.length, 4);
  assert.equal(singleShot.report.agents[0]?.turns, 1);
  assert.equal(singleShot.report.agents[0]?.toolCalls, 0);
  assert.equal(singleShot.report.hypotheses, 4);
  assert.ok(singleShotRouter.usage.calls >= 4);
});

test("CORTADO_SWARM_MODE single-shot forces the diff-only path even with a pack", async () => {
  const script = [JSON.stringify({ hypotheses: [] })];
  const box = sandbox();
  const ctx = context();
  const profile = await box.profile();
  const pack = await buildSwarmContext({ context: ctx, sandbox: box, profile });
  const forced = await runSwarm(ctx, request(), [], router(lunaWith(script)), silentLogger, 60_000, {
    sandbox: box,
    profile,
    pack,
    mode: "single-shot",
    maxTurns: 2,
    maxToolsPerTurn: 2,
  });
  assert.equal(forced.report.mode, "single-shot");
  assert.equal(forced.report.agents[0]?.turns, 1);
  assert.equal(forced.report.agents[0]?.toolCalls, 0);
});
