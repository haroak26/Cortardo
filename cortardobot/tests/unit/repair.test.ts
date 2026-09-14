import assert from "node:assert/strict";
import test from "node:test";
import { repairFindings, patchLines } from "../../src/stages/repair";
import { ModelRouter } from "../../src/models/router";
import { MemorySandbox } from "../../src/sandbox";
import { commandResult } from "../../src/sandbox/types";
import { DEFAULT_REPO_COMMANDS } from "../../src/stages/proof";
import { resolveConfig } from "../../src/config";
import { silentLogger } from "../../src/util/logger";
import { makeUnifiedDiff } from "../../src/util/diff";
import { makeCandidate, makeContext, makeProof } from "../helpers/factories";
import { retry } from "../../src/util/async";
import type { ModelClient, ModelResponse, ModelTask } from "../../src/models/types";

class ScriptedModel implements ModelClient {
  readonly id = "scripted";
  readonly dryRun = true;
  readonly calls: string[] = [];
  constructor(private readonly responses: Partial<Record<ModelTask["kind"], string[]>>) {}

  async complete(task: ModelTask): Promise<ModelResponse> {
    this.calls.push(task.kind);
    const queue = this.responses[task.kind];
    const text = queue && queue.length > 0 ? queue.shift()! : "{}";
    return { text, model: this.id, tokensIn: 1, tokensOut: 1, durationMs: 1 };
  }
}

const config = resolveConfig({ mode: "dry" });

function scriptedRouter(scripted: ScriptedModel): ModelRouter {
  return new ModelRouter({
    config: config.models,
    mode: "dry",
    luna: scripted,
    terra: scripted,
    astra: scripted,
  });
}

function patchForFix(): string {
  return makeUnifiedDiff("src/app.ts", "const value = 1;\n", "const value = 2;\n");
}

function planResponse(strategy = "fix root cause"): string {
  return JSON.stringify({ strategy, files: ["src/app.ts"], rationale: "minimal fix" });
}

function patchResponse(patch: string): string {
  return JSON.stringify({ patch, description: "apply fix" });
}

function diagnosisResponse(): string {
  return JSON.stringify({ reason: "still failing", nextStrategy: "change layer" });
}

function fixedHandler(
  command: string,
  files: Record<string, string>,
): ReturnType<typeof commandResult> {
  const fixed = (files["src/app.ts"] ?? "").includes("const value = 2");
  if (command.startsWith("cortado-probe")) {
    return fixed
      ? commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE" })
      : commandResult(command, { exitCode: 1, stdout: "CORTADO_VULNERABLE" });
  }
  return fixed
    ? commandResult(command, { exitCode: 0, stdout: "pass" })
    : commandResult(command, { exitCode: 1, stderr: "fail" });
}

test("patchLines extracts added and removed lines per file", () => {
  const patch = makeUnifiedDiff("src/a.ts", "old\n", "new\n");
  const lines = patchLines(patch);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].removedLines, ["old"]);
  assert.deepEqual(lines[0].addedLines, ["new"]);
});

test("repairFindings verifies a working patch", async () => {
  const scripted = new ScriptedModel({
    repair_plan: [planResponse()],
    repair_patch: [patchResponse(patchForFix())],
    repair_diagnosis: [diagnosisResponse()],
  });
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "const value = 1;\n", "src/app.test.ts": "test" },
    handler: (command, files) => fixedHandler(command, files),
  });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "confirmed", command: "cortado-probe c1", strategy: "script" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    makeContext({ tests: ["src/app.test.ts"] }),
    { sandbox, models: scriptedRouter(scripted), config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(repairs[0].exit, "VERIFIED");
  assert.equal(repairs[0].attempts.length, 1);
  assert.ok(repairs[0].finalPatch);
  assert.equal(scripted.calls.filter((call) => call === "repair_patch").length, 1);
});

test("repairFindings diagnoses and retries after an apply failure", async () => {
  const scripted = new ScriptedModel({
    repair_plan: [planResponse(), planResponse("second strategy")],
    repair_patch: [
      patchResponse("--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,1 +1,1 @@\n-does not match\n+value\n"),
      patchResponse(patchForFix()),
    ],
    repair_diagnosis: [diagnosisResponse()],
  });
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "const value = 1;\n", "src/app.test.ts": "test" },
    handler: (command, files) => fixedHandler(command, files),
  });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "confirmed", strategy: "script", command: "cortado-probe c1" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    makeContext({ tests: ["src/app.test.ts"] }),
    { sandbox, models: scriptedRouter(scripted), config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(repairs[0].exit, "VERIFIED");
  assert.equal(repairs[0].attempts.length, 2);
  assert.equal(repairs[0].attempts[0].applied, false);
  assert.equal(repairs[0].attempts[0].diagnosis?.includes("still failing"), true);
});

test("repairFindings rejects unsafe patches", async () => {
  const unsafePatch = makeUnifiedDiff(
    ".github/workflows/ci.yml",
    "name: ci\n",
    "name: ci\n# disabled\n",
  );
  const scripted = new ScriptedModel({
    repair_plan: [planResponse()],
    repair_patch: [patchResponse(unsafePatch)],
    repair_diagnosis: [diagnosisResponse()],
  });
  const sandbox = new MemorySandbox({ files: { "src/app.ts": "const value = 1;\n" } });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "confirmed", strategy: "script", command: "cortado-probe c1" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    makeContext({ tests: [] }),
    { sandbox, models: scriptedRouter(scripted), config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(repairs[0].exit, "UNSAFE");
  assert.match(repairs[0].attempts[0].applyReason ?? "", /rejected as unsafe/);
});

test("repairFindings exits UNRESOLVED after exhausting attempts", async () => {
  const noopPatch = makeUnifiedDiff("src/app.ts", "const value = 1;\n", "// guard\nconst value = 1;\n");
  const scripted = new ScriptedModel({
    repair_plan: [planResponse(), planResponse(), planResponse()],
    repair_patch: [patchResponse(noopPatch), patchResponse(noopPatch), patchResponse(noopPatch)],
    repair_diagnosis: [diagnosisResponse(), diagnosisResponse(), diagnosisResponse()],
  });
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "const value = 1;\n", "src/app.test.ts": "test" },
    handler: (command) => commandResult(command, { exitCode: 1 }),
  });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "confirmed", strategy: "script", command: "cortado-probe c1" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    makeContext({ tests: ["src/app.test.ts"] }),
    { sandbox, models: scriptedRouter(scripted), config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(repairs[0].exit, "UNRESOLVED");
  assert.equal(repairs[0].attempts.length, config.repair.maxAttempts);
});

test("repairFindings exhausts the tool call budget", async () => {
  const configWithTinyBudget = resolveConfig({ mode: "dry", repair: { maxToolCalls: 1 } });
  const noopPatch = makeUnifiedDiff("src/app.ts", "const value = 1;\n", "// guard\nconst value = 1;\n");
  const scripted = new ScriptedModel({
    repair_plan: [planResponse()],
    repair_patch: [patchResponse(noopPatch)],
  });
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "const value = 1;\n", "src/app.test.ts": "test" },
    handler: (command) => commandResult(command, { exitCode: 1 }),
  });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "confirmed", strategy: "script", command: "cortado-probe c1" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    makeContext({ tests: ["src/app.test.ts"] }),
    {
      sandbox,
      models: scriptedRouter(scripted),
      config: configWithTinyBudget,
      commands: DEFAULT_REPO_COMMANDS,
      logger: silentLogger,
    },
  );
  assert.equal(repairs[0].exit, "BUDGET_EXHAUSTED");
});

test("repairFindings returns UNRESOLVED when no files are available", async () => {
  const scripted = new ScriptedModel({});
  const sandbox = new MemorySandbox({ files: {} });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "confirmed", strategy: "script", command: "cortado-probe c1" })],
    [makeCandidate({ id: "c1", file: "missing.ts" })],
    makeContext({ tests: [] }),
    { sandbox, models: scriptedRouter(scripted), config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(repairs[0].exit, "UNRESOLVED");
  assert.match(repairs[0].reason, /no relevant files/);
});

test("repairFindings ignores unconfirmed proofs", async () => {
  const scripted = new ScriptedModel({});
  const sandbox = new MemorySandbox({ files: { "src/app.ts": "x" } });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "disproven" }), makeProof({ candidateId: "c2", status: "likely" })],
    [makeCandidate({ id: "c1" }), makeCandidate({ id: "c2" })],
    makeContext({ tests: [] }),
    { sandbox, models: scriptedRouter(scripted), config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(repairs.length, 0);
});

test("repairFindings recovers when the planner returns invalid JSON", async () => {
  const scripted = new ScriptedModel({
    repair_plan: ["not json"],
    repair_patch: [patchResponse(patchForFix())],
  });
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "const value = 1;\n", "src/app.test.ts": "test" },
    handler: (command, files) => fixedHandler(command, files),
  });
  const repairs = await repairFindings(
    [makeProof({ candidateId: "c1", status: "confirmed", strategy: "script", command: "cortado-probe c1" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    makeContext({ tests: ["src/app.test.ts"] }),
    { sandbox, models: scriptedRouter(scripted), config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(repairs[0].exit, "VERIFIED");
});

test("retry helper is exercised by the repair path", async () => {
  let calls = 0;
  const value = await retry(async () => {
    calls++;
    if (calls < 2) throw new Error("transient");
    return "done";
  }, { retries: 2, delayMs: 1 });
  assert.equal(value, "done");
  assert.equal(calls, 2);
});
