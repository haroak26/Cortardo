import assert from "node:assert/strict";
import test from "node:test";
import { createDrySimulationHandler } from "../../src/sandbox/dry-simulation";
import { contentFile } from "../helpers/factories";
import type { ExecResult } from "../../src/sandbox/types";

const exec = (
  handler: ReturnType<typeof createDrySimulationHandler>,
  command: string,
  files: Record<string, string>,
): ExecResult => handler(command, files, 1) as ExecResult;

const buggyFiles = {
  "server/auth/session.ts": 'if (sessionUserId == userId) {\n  return false;\n}\n',
  "server/auth/session.test.ts": "test('owner', () => {});\n",
};

const fixedFiles = {
  "server/auth/session.ts": 'if (sessionUserId === userId) {\n  return false;\n}\n',
  "server/auth/session.test.ts": "test('owner', () => {});\n",
};

const changed = [contentFile("server/auth/session.ts", buggyFiles["server/auth/session.ts"])];

test("dry simulation fails tests while the defect is present", () => {
  const handler = createDrySimulationHandler(changed);
  const result = exec(handler, "npm test -- server/auth/session.test.ts", buggyFiles);
  assert.equal(result.exitCode, 1);
  assert.match(result.stderr, /AssertionError/);
});

test("dry simulation passes tests once the defect is fixed", () => {
  const handler = createDrySimulationHandler(changed);
  exec(handler, "npm test -- server/auth/session.test.ts", buggyFiles);
  const result = exec(handler, "npm test -- server/auth/session.test.ts", fixedFiles);
  assert.equal(result.exitCode, 0);
});

test("dry simulation reports the probe marker", () => {
  const handler = createDrySimulationHandler(changed);
  assert.match(exec(handler, "cortado-probe c1", buggyFiles).stdout, /CORTADO_VULNERABLE/);
  assert.match(exec(handler, "cortado-probe c1", fixedFiles).stdout, /CORTADO_SAFE/);
});

test("dry simulation scopes tests to the related source file", () => {
  const files = [
    contentFile("server/auth/session.ts", buggyFiles["server/auth/session.ts"]),
    contentFile("server/users/repo.ts", "return db.query(`SELECT * FROM t WHERE id = ${id}`);"),
  ];
  const handler = createDrySimulationHandler(files);
  const current = {
    "server/auth/session.ts": fixedFiles["server/auth/session.ts"],
    "server/users/repo.ts": "return db.query(`SELECT * FROM t WHERE id = ${id}`);",
  };
  assert.equal(exec(handler, "npm test -- server/auth/session.test.ts", current).exitCode, 0);
});

test("dry simulation supports neverReproduce and alwaysFail", () => {
  const never = createDrySimulationHandler(changed, { neverReproduce: true });
  assert.equal(exec(never, "npm test", buggyFiles).exitCode, 0);
  assert.match(exec(never, "cortado-probe c1", buggyFiles).stdout, /CORTADO_SAFE/);

  const broken = createDrySimulationHandler(changed, { alwaysFail: true });
  assert.equal(exec(broken, "npm test", buggyFiles).exitCode, 127);
});

test("dry simulation leaves typecheck and build passing", () => {
  const handler = createDrySimulationHandler(changed);
  assert.equal(exec(handler, "npx tsc --noEmit", buggyFiles).exitCode, 0);
  assert.equal(exec(handler, "npm run build", buggyFiles).exitCode, 0);
});
