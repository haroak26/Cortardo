import assert from "node:assert/strict";
import test from "node:test";
import { verifyRepairs } from "../../src/stages/verify";
import { DEFAULT_REPO_COMMANDS } from "../../src/stages/proof";
import { resolveConfig } from "../../src/config";
import { MemorySandbox } from "../../src/sandbox";
import { commandResult } from "../../src/sandbox/types";
import { silentLogger } from "../../src/util/logger";
import { makeCandidate, makeContext, makeProof, makeRepair } from "../helpers/factories";

const config = resolveConfig({ mode: "dry" });

function verifyWith(options: {
  commandHandler?: (command: string) => ReturnType<typeof commandResult>;
  proof?: ReturnType<typeof makeProof>;
  size?: "tiny" | "normal" | "complex";
  tests?: string[];
}) {
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "content", "src/app.test.ts": "test" },
    handler: (command) =>
      options.commandHandler ? options.commandHandler(command) : commandResult(command, { exitCode: 0 }),
  });
  return verifyRepairs(
    [makeRepair({ candidateId: "c1", exit: "VERIFIED" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    [options.proof ?? makeProof({ candidateId: "c1", command: "npm test -- src/app.test.ts" })],
    makeContext({ tests: options.tests ?? ["src/app.test.ts"], size: options.size ?? "normal" }),
    { sandbox, config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
}

test("verifyRepairs runs reproduction and targeted tests", async () => {
  const reports = await verifyWith({});
  const report = reports.get("c1");
  assert.ok(report);
  assert.equal(report.passed, true);
  const kinds = report.steps.map((step) => step.kind);
  assert.ok(kinds.includes("reproduction"));
  assert.ok(kinds.includes("targeted_tests"));
});

test("verifyRepairs marks failing verification", async () => {
  const reports = await verifyWith({
    commandHandler: (command) =>
      command.includes("reproduction") || command.includes("app.test")
        ? commandResult(command, { exitCode: 1, stderr: "still broken" })
        : commandResult(command, { exitCode: 0 }),
  });
  assert.equal(reports.get("c1")?.passed, false);
});

test("verifyRepairs skips expensive steps for tiny changes", async () => {
  const reports = await verifyWith({ size: "tiny" });
  const report = reports.get("c1");
  assert.ok(report);
  const affected = report.steps.find((step) => step.kind === "affected_tests");
  const typecheck = report.steps.find((step) => step.kind === "typecheck");
  const build = report.steps.find((step) => step.kind === "build");
  assert.equal(affected?.skipped, true);
  assert.equal(typecheck?.skipped, true);
  assert.equal(build?.skipped, true);
});

test("verifyRepairs runs typecheck for normal typed changes", async () => {
  const reports = await verifyWith({});
  const typecheck = reports.get("c1")?.steps.find((step) => step.kind === "typecheck");
  assert.equal(typecheck?.skipped, false);
});

test("verifyRepairs requires the CORTADO_SAFE marker for script proofs", async () => {
  const reports = await verifyWith({
    proof: makeProof({ candidateId: "c1", strategy: "script", command: "cortado-probe c1" }),
    commandHandler: (command) =>
      command.includes("cortado-probe")
        ? commandResult(command, { exitCode: 0, stdout: "CORTADO_VULNERABLE" })
        : commandResult(command, { exitCode: 0 }),
  });
  assert.equal(reports.get("c1")?.passed, false);

  const safe = await verifyWith({
    proof: makeProof({ candidateId: "c1", strategy: "script", command: "cortado-probe c1" }),
    commandHandler: (command) =>
      command.includes("cortado-probe")
        ? commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE" })
        : commandResult(command, { exitCode: 0 }),
  });
  assert.equal(safe.get("c1")?.passed, true);
});

test("verifyRepairs skips non-verified repairs", async () => {
  const sandbox = new MemorySandbox({ files: {} });
  const reports = await verifyRepairs(
    [makeRepair({ candidateId: "c1", exit: "UNRESOLVED" }), makeRepair({ candidateId: "c2", exit: "UNSAFE" })],
    [makeCandidate({ id: "c1" }), makeCandidate({ id: "c2" })],
    [],
    makeContext(),
    { sandbox, config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  assert.equal(reports.size, 0);
});

test("verifyRepairs marks reproduction skipped without a command", async () => {
  const sandbox = new MemorySandbox({ files: { "src/app.ts": "content" } });
  const reports = await verifyRepairs(
    [makeRepair({ candidateId: "c1" })],
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    [makeProof({ candidateId: "c1", command: undefined })],
    makeContext({ tests: [] }),
    { sandbox, config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
  const reproduction = reports.get("c1")?.steps.find((step) => step.kind === "reproduction");
  assert.equal(reproduction?.skipped, true);
});
