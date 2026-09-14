import assert from "node:assert/strict";
import test from "node:test";
import { CortadoEngine, reviewPullRequest } from "../../src/engine";
import { FIXTURES, fixtureFiles } from "../../fixtures/prs";
import { ScenarioSandbox } from "../dry/scenario";
import { SimulatedClock } from "../../src/util/clock";
import { silentLogger } from "../../src/util/logger";
import { makeUnifiedDiff } from "../../src/util/diff";
import type { ModelClient, ModelResponse, ModelTask } from "../../src/models/types";

test("engine defaults to dry mode", () => {
  const engine = new CortadoEngine({});
  assert.equal(engine.config.mode, "dry");
});

test("engine refuses live mode without an API key", () => {
  assert.throws(() => new CortadoEngine({ mode: "live" }), /CORTADO_AI_API_KEY/);
});

test("engine runs a pull request end to end", async () => {
  const engine = new CortadoEngine({ logger: silentLogger });
  const result = await engine.run({ id: "pr-simple", title: "Simple change", files: [] });
  assert.equal(result.status, "completed");
  assert.equal(result.dryRun, true);
  assert.equal(result.findings.length, 0);
  assert.match(result.markdown, /# Cortado Review/);
  assert.ok(result.usage.calls > 0);
});

test("engine dry mode simulates proof and repair without a handler", async () => {
  const sessionBefore = 'export function authorize(userId: string, sessionUserId: string): boolean {\n  if (sessionUserId !== userId) {\n    return false;\n  }\n  return true;\n}\n';
  const sessionAfter = sessionBefore.replace("!==", "==");
  const engine = new CortadoEngine({ logger: silentLogger });
  const result = await engine.run({
    id: "pr-auth",
    title: "Fix session check",
    files: [
      {
        path: "server/auth/session.ts",
        content: sessionAfter,
        patch: makeUnifiedDiff("server/auth/session.ts", sessionBefore, sessionAfter),
      },
      {
        path: "server/auth/session.test.ts",
        content: "test('owner', () => {});\n",
      },
    ],
  });
  assert.equal(result.status, "completed");
  assert.equal(result.summary.issuesConfirmed, 1);
  assert.equal(result.summary.issuesVerified, 1);
  assert.match(result.markdown, /\[FIXED\]/);
});

test("reviewPullRequest convenience wrapper works", async () => {
  const result = await reviewPullRequest({ title: "Wrapper", files: [] }, { logger: silentLogger });
  assert.equal(result.status, "completed");
});

test("engine reports failed runs for malformed input", async () => {
  const engine = new CortadoEngine({ logger: silentLogger });
  const result = await engine.run({
    title: "Broken",
    files: undefined as never,
  });
  assert.equal(result.status, "failed");
  assert.ok(result.error);
  assert.match(result.markdown, /Run failed/);
});

test("engine enforces the global timeout", async () => {
  const slow: ModelClient = {
    id: "slow",
    dryRun: true,
    complete: async (_task: ModelTask): Promise<ModelResponse> => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return { text: "{}", model: "slow", tokensIn: 1, tokensOut: 1, durationMs: 60 };
    },
  };
  const engine = new CortadoEngine({
    models: { luna: slow, terra: slow, astra: slow },
    globalTimeoutMs: 5,
    logger: silentLogger,
  });
  const result = await engine.run({ title: "Timeout", files: [] });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /timed out/);
});

test("engine passes dry repair behavior into the model router", async () => {
  const fixture = FIXTURES[0];
  const clock = new SimulatedClock();
  const sandbox = new ScenarioSandbox(
    { fixture, proof: "confirm", repair: "always-fail" },
    fixtureFiles(fixture),
    clock,
  );
  const engine = new CortadoEngine({
    mode: "dry",
    sandbox,
    clock,
    logger: silentLogger,
    dryOptions: { repairBehavior: "always-fail" },
  });
  const result = await engine.run(fixture.pullRequest);
  assert.equal(result.status, "completed");
  assert.equal(result.repairs.length, 1);
  assert.equal(result.repairs[0].exit, "UNRESOLVED");
});

test("engine exposes sandbox commands through the handler", async () => {
  const fixture = FIXTURES[1];
  const clock = new SimulatedClock();
  const sandbox = new ScenarioSandbox(
    { fixture, proof: "confirm", repair: "fix" },
    fixtureFiles(fixture),
    clock,
  );
  const engine = new CortadoEngine({ mode: "dry", sandbox, clock, logger: silentLogger });
  const result = await engine.run(fixture.pullRequest);
  assert.equal(result.status, "completed");
  assert.ok(sandbox.commands.length > 0);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].repair?.exit, "VERIFIED");
});
