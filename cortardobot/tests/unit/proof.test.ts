import assert from "node:assert/strict";
import test from "node:test";
import {
  buildProofSteps,
  discoverTests,
  evaluateStep,
  proveCandidates,
  relatedTests,
  strategiesFor,
  DEFAULT_REPO_COMMANDS,
} from "../../src/stages/proof";
import { resolveConfig } from "../../src/config";
import { MemorySandbox } from "../../src/sandbox";
import { commandResult } from "../../src/sandbox/types";
import { SimulatedClock } from "../../src/util/clock";
import { silentLogger } from "../../src/util/logger";
import { makeCandidate, makeContext } from "../helpers/factories";
import type { JudgeDecision, ProofStep } from "../../src/types";

const config = resolveConfig({ mode: "dry" });

function step(overrides: Partial<ProofStep> = {}): ProofStep {
  return {
    strategy: overrides.strategy ?? "existing_test",
    command: overrides.command ?? "npm test -- a.test.ts",
    expectation: overrides.expectation ?? "fail",
    marker: overrides.marker,
    description: overrides.description ?? "desc",
  };
}

test("relatedTests finds matching test files", () => {
  const context = makeContext({
    tests: ["server/auth/session.test.ts", "server/other.test.ts"],
  });
  const tests = relatedTests(makeCandidate({ file: "server/auth/session.ts" }), context);
  assert.deepEqual(tests, ["server/auth/session.test.ts"]);
});

test("relatedTests includes tests that import the changed file", () => {
  const context = makeContext({
    tests: ["tests/integration.test.ts"],
    dependencies: [{ from: "tests/integration.test.ts", to: "src/app.ts", kind: "imports" }],
  });
  const tests = relatedTests(makeCandidate({ file: "src/app.ts" }), context);
  assert.deepEqual(tests, ["tests/integration.test.ts"]);
});

test("discoverTests falls back to scanning the sandbox", async () => {
  const sandbox = new MemorySandbox({
    files: {
      "server/auth/session.test.ts": "test('a', () => {});",
      "server/unrelated.test.ts": "test('b', () => {});",
    },
  });
  const tests = await discoverTests(makeCandidate({ file: "server/auth/session.ts" }), makeContext(), sandbox);
  assert.deepEqual(tests, ["server/auth/session.test.ts"]);
});

test("discoverTests prefers context tests over the sandbox", async () => {
  const sandbox = new MemorySandbox({ files: { "server/other.test.ts": "" } });
  const context = makeContext({ tests: ["server/auth/session.test.ts"] });
  const tests = await discoverTests(makeCandidate({ file: "server/auth/session.ts" }), context, sandbox);
  assert.deepEqual(tests, ["server/auth/session.test.ts"]);
});

test("buildProofSteps orders strategies cheap-first", () => {
  const decision: JudgeDecision = {
    hypothesisId: "c1",
    verdict: "PROVE",
    reason: "",
    priority: 1,
    reproductionCommand: "cortado-probe c1",
  };
  const steps = buildProofSteps(
    makeCandidate({ file: "src/app.ts", symbol: "run" }),
    decision,
    ["src/app.test.ts"],
    DEFAULT_REPO_COMMANDS,
  );
  assert.deepEqual(steps.map((item) => item.strategy), ["existing_test", "targeted_test", "script"]);
  assert.equal(steps[0].expectation, "fail");
  assert.equal(steps[2].expectation, "marker");
  assert.equal(steps[2].marker, "CORTADO_VULNERABLE");
});

test("buildProofSteps falls back to the full environment without tests", () => {
  const steps = buildProofSteps(
    makeCandidate({ file: "config/app.ts" }),
    { hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1 },
    [],
    DEFAULT_REPO_COMMANDS,
  );
  assert.deepEqual(steps.map((item) => item.strategy), ["full_environment"]);
});

test("strategiesFor reports the strategy chain", () => {
  const strategies = strategiesFor(makeCandidate({ file: "src/app.ts" }), makeContext({ tests: ["src/app.test.ts"] }), DEFAULT_REPO_COMMANDS);
  assert.deepEqual(strategies, ["existing_test"]);
});

test("evaluateStep handles fail expectations", () => {
  assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 1 })), "match");
  assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 0 })), "refute");
  assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 0, timedOut: true })), "inconclusive");
});

test("evaluateStep handles pass expectations", () => {
  const passStep = step({ expectation: "pass" });
  assert.equal(evaluateStep(passStep, commandResult("x", { exitCode: 0 })), "match");
  assert.equal(evaluateStep(passStep, commandResult("x", { exitCode: 1 })), "refute");
});

test("evaluateStep handles marker expectations", () => {
  const markerStep = step({ expectation: "marker", marker: "CORTADO_VULNERABLE" });
  assert.equal(evaluateStep(markerStep, commandResult("x", { stdout: "CORTADO_VULNERABLE" })), "match");
  assert.equal(evaluateStep(markerStep, commandResult("x", { exitCode: 0, stdout: "CORTADO_SAFE" })), "refute");
  assert.equal(evaluateStep(markerStep, commandResult("x", { exitCode: 1, stdout: "crash" })), "inconclusive");
});

test("evaluateStep treats missing commands as inconclusive", () => {
  assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 127, stderr: "command not found" })), "inconclusive");
  assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 1, stderr: "ENOENT" })), "inconclusive");
});

async function proveWith(
  handler: (command: string) => ReturnType<typeof commandResult>,
  overrides: Partial<Parameters<typeof proveCandidates>[3]> = {},
) {
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "content", "src/app.test.ts": "test" },
    handler: (command) => handler(command),
  });
  return proveCandidates(
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    [{ hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1, reproductionCommand: "cortado-probe c1" }],
    makeContext({ tests: ["src/app.test.ts"] }),
    {
      sandbox,
      config,
      commands: DEFAULT_REPO_COMMANDS,
      logger: silentLogger,
      ...overrides,
    },
  );
}

test("proveCandidates confirms a failing existing test", async () => {
  const results = await proveWith((command) =>
    command.includes("cortado-probe")
      ? commandResult(command, { stdout: "CORTADO_VULNERABLE" })
      : commandResult(command, { exitCode: 1, stderr: "AssertionError" }),
  );
  assert.equal(results[0].status, "confirmed");
  assert.equal(results[0].strategy, "existing_test");
  assert.equal(results[0].attempts.length, 1);
  assert.ok(results[0].reproduction?.includes("AssertionError"));
});

test("proveCandidates disproves when every experiment passes", async () => {
  const results = await proveWith((command) =>
    command.includes("cortado-probe")
      ? commandResult(command, { stdout: "CORTADO_SAFE" })
      : commandResult(command, { exitCode: 0, stdout: "pass" }),
  );
  assert.equal(results[0].status, "disproven");
  assert.ok(results[0].attempts.length >= 1);
});

test("proveCandidates reports an error when execution never settles", async () => {
  const results = await proveWith((command) => commandResult(command, { exitCode: 124, timedOut: true }));
  assert.equal(results[0].status, "error");
});

test("proveCandidates retries a cheaper strategy after a refutation", async () => {
  let testCalls = 0;
  const results = await proveWith((command) => {
    if (command.includes("cortado-probe")) return commandResult(command, { stdout: "CORTADO_VULNERABLE" });
    testCalls++;
    return testCalls === 1
      ? commandResult(command, { exitCode: 0, stdout: "pass" })
      : commandResult(command, { exitCode: 1, stderr: "AssertionError" });
  });
  assert.equal(results[0].status, "confirmed");
  assert.equal(results[0].strategy, "script");
  assert.equal(results[0].attempts.length, 2);
});

test("proveCandidates marks likely when refutations and inconclusive results mix", async () => {
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "content", "src/app.test.ts": "test" },
    handler: (command) =>
      command.includes("cortado-probe")
        ? commandResult(command, { exitCode: 124, timedOut: true })
        : commandResult(command, { exitCode: 0, stdout: "pass" }),
  });
  const results = await proveCandidates(
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    [{ hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1, reproductionCommand: "cortado-probe c1" }],
    makeContext({ tests: ["src/app.test.ts"] }),
    { sandbox, config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(results[0].status, "likely");
});

test("proveCandidates respects the per-run hypothesis cap", async () => {
  const sandbox = new MemorySandbox({
    files: { "src/a.ts": "content" },
    handler: (command) => commandResult(command, { exitCode: 1 }),
  });
  const candidates = Array.from({ length: 6 }, (_, index) =>
    makeCandidate({ id: `c${index}`, file: `src/a${index}.ts`, evidence: [`src/a${index}.ts:1`] }),
  );
  const decisions: JudgeDecision[] = candidates.map((candidate, index) => ({
    hypothesisId: candidate.id,
    verdict: "PROVE",
    reason: "",
    priority: index + 1,
    reproductionCommand: `cortado-probe ${candidate.id}`,
  }));
  const results = await proveCandidates(candidates, decisions, makeContext(), {
    sandbox,
    config: resolveConfig({ mode: "dry", proof: { maxHypotheses: 2 } }),
    commands: DEFAULT_REPO_COMMANDS,
    logger: silentLogger,
  });
  assert.equal(results.length, 2);
});

test("proveCandidates skips hypotheses when the total budget is exhausted", async () => {
  const clock = new SimulatedClock(0, 10_000);
  const sandbox = new MemorySandbox({ files: { "src/app.ts": "content" } });
  const results = await proveCandidates(
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    [{ hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1 }],
    makeContext(),
    {
      sandbox,
      config: resolveConfig({ mode: "dry", proof: { totalMs: 1 } }),
      commands: DEFAULT_REPO_COMMANDS,
      logger: silentLogger,
      now: () => clock.now(),
    },
  );
  assert.equal(results[0].status, "error");
  assert.match(results[0].explanation, /budget/);
});
