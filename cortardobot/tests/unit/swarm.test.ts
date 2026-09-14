import assert from "node:assert/strict";
import test from "node:test";
import { selectAgents } from "../../src/agents/roster";
import { filesForAgent, runSwarm } from "../../src/stages/swarm";
import { resolveConfig } from "../../src/config";
import { ModelRouter } from "../../src/models/router";
import { silentLogger } from "../../src/util/logger";
import { contentFile, makeContext, makeChangedFile } from "../helpers/factories";
import type { ModelClient, ModelResponse, ModelTask } from "../../src/models/types";

const config = resolveConfig({ mode: "dry" });

class SequenceModel implements ModelClient {
  readonly id = "sequence";
  readonly dryRun = true;
  calls: Array<{ kind: string; label?: string }> = [];
  constructor(private readonly handler: (task: ModelTask) => ModelResponse) {}
  async complete(task: ModelTask): Promise<ModelResponse> {
    this.calls.push({ kind: task.kind, label: task.label });
    return this.handler(task);
  }
}

function routerWith(luna: ModelClient): ModelRouter {
  return new ModelRouter({ config: config.models, mode: "dry", luna, terra: luna, astra: luna });
}

function hypothesisResponse(claim: string): string {
  return JSON.stringify({
    hypotheses: [
      {
        claim,
        evidence: ["src/app.ts:3"],
        severity: "high",
        confidence: 0.8,
        suggestedExperiment: "run the test",
      },
    ],
  });
}

test("selectAgents caps tiny PRs at three agents", () => {
  const agents = selectAgents(
    makeContext({ size: "tiny", classification: ["AUTH", "API", "DATABASE"], tests: ["src/a.test.ts"] }),
    config,
  );
  assert.equal(agents.length, 3);
  assert.ok(agents.some((agent) => agent.kind === "bug"));
});

test("selectAgents caps complex PRs at twelve agents", () => {
  const agents = selectAgents(
    makeContext({ size: "complex", classification: ["AUTH", "API", "DATABASE", "UI", "PERFORMANCE", "CONFIG"], tests: ["src/a.test.ts"], callers: ["src/b.ts"] }),
    config,
  );
  assert.ok(agents.length <= config.swarm.complex);
  assert.ok(agents.length >= 8);
});

test("selectAgents adds auth and security for AUTH changes", () => {
  const agents = selectAgents(makeContext({ size: "normal", classification: ["AUTH"] }), config);
  assert.ok(agents.some((agent) => agent.kind === "auth"));
  assert.ok(agents.some((agent) => agent.kind === "security"));
});

test("selectAgents adds database and ui specialists", () => {
  const database = selectAgents(makeContext({ size: "normal", classification: ["DATABASE"] }), config);
  assert.ok(database.some((agent) => agent.kind === "database"));
  const ui = selectAgents(makeContext({ size: "normal", classification: ["UI"] }), config);
  assert.ok(ui.some((agent) => agent.kind === "ui"));
});

test("selectAgents reacts to risk signals", () => {
  const agents = selectAgents(
    makeContext({
      size: "normal",
      classification: ["CONFIG"],
      riskSignals: [{ id: "secret-literal", detail: "", weight: 3 }],
    }),
    config,
  );
  assert.ok(agents.some((agent) => agent.kind === "security"));
});

test("filesForAgent narrows to relevant files", () => {
  const context = makeContext({
    files: [
      makeChangedFile("server/auth/session.ts", { added: ["session.token = value"] }),
      makeChangedFile("client/components/App.tsx", { added: ["el.innerHTML = body"] }),
    ],
  });
  const authFiles = filesForAgent({ id: "a", kind: "auth", title: "", focus: "", priority: 1 }, context);
  assert.deepEqual(authFiles.map((file) => file.path), ["server/auth/session.ts"]);
  const uiFiles = filesForAgent({ id: "u", kind: "ui", title: "", focus: "", priority: 1 }, context);
  assert.deepEqual(uiFiles.map((file) => file.path), ["client/components/App.tsx"]);
});

test("runSwarm collects hypotheses from agents", async () => {
  const luna = new SequenceModel((task) => ({
    text: hypothesisResponse(`Defect found by ${task.label}`),
    model: "sequence",
    tokensIn: 5,
    tokensOut: 5,
    durationMs: 1,
  }));
  const context = makeContext({
    size: "normal",
    classification: ["AUTH"],
    files: [makeChangedFile("server/auth/session.ts", { added: ["if (session.userId == id) return null;"] })],
  });
  const report = await runSwarm(context, { title: "t", files: [] }, routerWith(luna), config, silentLogger);
  assert.ok(report.agents.length >= 3);
  assert.equal(report.hypotheses.length, report.agents.length);
  assert.ok(report.hypotheses.every((hypothesis) => hypothesis.id.startsWith("h_")));
  assert.ok(report.agents.every((agent) => agent.status === "ok"));
});

test("runSwarm records parse failures without failing the pipeline", async () => {
  const luna = new SequenceModel(() => ({
    text: "not json at all",
    model: "sequence",
    tokensIn: 1,
    tokensOut: 1,
    durationMs: 1,
  }));
  const context = makeContext({ size: "tiny", classification: ["AUTH"] });
  const report = await runSwarm(context, { title: "t", files: [] }, routerWith(luna), config, silentLogger);
  assert.equal(report.hypotheses.length, 0);
  assert.ok(report.agents.every((agent) => agent.status === "ok"));
  assert.ok(report.agents.every((agent) => agent.hypotheses === 0));
});

test("runSwarm records agent errors", async () => {
  const luna: ModelClient = {
    id: "boom",
    dryRun: true,
    complete: async () => {
      throw new Error("model exploded");
    },
  };
  const report = await runSwarm(
    makeContext({ size: "tiny", classification: ["AUTH"] }),
    { title: "t", files: [] },
    routerWith(luna),
    config,
    silentLogger,
  );
  assert.ok(report.agents.some((agent) => agent.status === "error"));
  assert.equal(report.hypotheses.length, 0);
});

test("runSwarm filters evidence that is not file:line", async () => {
  const luna = new SequenceModel(() => ({
    text: JSON.stringify({
      hypotheses: [
        {
          claim: "Bad evidence entry",
          evidence: ["not-a-location"],
          severity: "high",
          confidence: 0.9,
          suggestedExperiment: "run",
        },
      ],
    }),
    model: "sequence",
    tokensIn: 1,
    tokensOut: 1,
    durationMs: 1,
  }));
  const report = await runSwarm(
    makeContext({ size: "tiny", classification: ["AUTH"] }),
    { title: "t", files: [] },
    routerWith(luna),
    config,
    silentLogger,
  );
  assert.equal(report.hypotheses.length, 0);
});
