import assert from "node:assert/strict";
import test from "node:test";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSandbox, LocalSandbox, MemorySandbox } from "../../src/sandbox";
import { commandResult } from "../../src/sandbox/types";
import { makeUnifiedDiff } from "../../src/util/diff";

test("MemorySandbox supports read, write, exists and list", async () => {
  const sandbox = new MemorySandbox({ files: { "src/a.ts": "a", "src/b.ts": "b" } });
  assert.equal(await sandbox.read("src/a.ts"), "a");
  assert.equal(await sandbox.exists("src/a.ts"), true);
  assert.equal(await sandbox.exists("missing.ts"), false);
  await sandbox.write("src/c.ts", "c");
  assert.deepEqual(await sandbox.list("src"), ["src/a.ts", "src/b.ts", "src/c.ts"]);
  assert.deepEqual(await sandbox.list(), ["src/a.ts", "src/b.ts", "src/c.ts"]);
});

test("MemorySandbox read throws for missing files", async () => {
  const sandbox = new MemorySandbox();
  await assert.rejects(() => sandbox.read("nope.ts"), /file not found/);
});

test("MemorySandbox exposes snapshots", async () => {
  const sandbox = new MemorySandbox({ files: { "a.ts": "a" } });
  await sandbox.write("b.ts", "b");
  assert.deepEqual(await sandbox.snapshot(), { "a.ts": "a", "b.ts": "b" });
});

test("MemorySandbox uses the exec handler and counts tool calls", async () => {
  const commands: string[] = [];
  const sandbox = new MemorySandbox({
    files: { "a.ts": "a" },
    handler: (command) => {
      commands.push(command);
      return commandResult(command, { stdout: "handled" });
    },
  });
  const result = await sandbox.exec("npm test");
  assert.equal(result.stdout, "handled");
  assert.equal(sandbox.toolCalls, 1);
  assert.deepEqual(commands, ["npm test"]);
});

test("MemorySandbox blocks dangerous commands and still counts the call", async () => {
  const sandbox = new MemorySandbox();
  const result = await sandbox.exec("rm -rf /");
  assert.equal(result.exitCode, 126);
  assert.match(result.stderr, /blocked by sandbox policy/);
  assert.equal(sandbox.toolCalls, 1);
});

test("MemorySandbox applies patches atomically per file", async () => {
  const sandbox = new MemorySandbox({ files: { "src/a.ts": "const a = 1;\n" } });
  const patch = makeUnifiedDiff("src/a.ts", "const a = 1;\n", "const a = 2;\n");
  const result = await sandbox.applyPatch(patch);
  assert.equal(result.ok, true);
  assert.equal(await sandbox.read("src/a.ts"), "const a = 2;\n");
  assert.equal(sandbox.toolCalls, 1);
});

test("MemorySandbox reports patch failures", async () => {
  const sandbox = new MemorySandbox({ files: { "src/a.ts": "unrelated\n" } });
  const patch = makeUnifiedDiff("src/a.ts", "const a = 1;\n", "const a = 2;\n");
  const result = await sandbox.applyPatch(patch);
  assert.equal(result.ok, false);
  assert.match(result.files[0].reason ?? "", /could not be located/);
});

test("createSandbox builds memory sandboxes in dry mode", () => {
  const sandbox = createSandbox({ mode: "dry", files: { "a.ts": "a" } });
  assert.equal(sandbox.dryRun, true);
  assert.ok(sandbox instanceof MemorySandbox);
});

test("createSandbox builds local sandboxes in live mode", () => {
  const sandbox = createSandbox({ mode: "live" });
  assert.equal(sandbox.dryRun, false);
  assert.ok(sandbox instanceof LocalSandbox);
});

test("LocalSandbox writes initial files, reads and executes", async () => {
  const root = path.join(os.tmpdir(), `cortado-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandbox = new LocalSandbox({ root, files: { "src/a.ts": "const a = 1;\n" }, timeoutMs: 5000 });
  try {
    await sandbox.setup();
    assert.equal(await sandbox.read("src/a.ts"), "const a = 1;\n");
    await sandbox.write("src/b.ts", "const b = 2;\n");
    assert.equal(await sandbox.exists("src/b.ts"), true);
    assert.deepEqual(await sandbox.list("src"), ["src/a.ts", "src/b.ts"]);
    const result = await sandbox.exec("printf hello");
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello");
  } finally {
    await sandbox.cleanup();
  }
});

test("LocalSandbox prevents path escapes", async () => {
  const root = path.join(os.tmpdir(), `cortado-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandbox = new LocalSandbox({ root, files: {} });
  try {
    await sandbox.setup();
    await assert.rejects(() => sandbox.write("../escape.ts", "x"), /escapes sandbox root/);
  } finally {
    await sandbox.cleanup();
  }
});

test("LocalSandbox applies patches to disk", async () => {
  const root = path.join(os.tmpdir(), `cortado-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandbox = new LocalSandbox({ root, files: { "src/a.ts": "const a = 1;\n" } });
  try {
    await sandbox.setup();
    const patch = makeUnifiedDiff("src/a.ts", "const a = 1;\n", "const a = 2;\n");
    const result = await sandbox.applyPatch(patch);
    assert.equal(result.ok, true);
    assert.equal(await sandbox.read("src/a.ts"), "const a = 2;\n");
  } finally {
    await sandbox.cleanup();
  }
});

test("LocalSandbox timeout kills long commands", async () => {
  const root = path.join(os.tmpdir(), `cortado-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandbox = new LocalSandbox({ root, files: {}, timeoutMs: 200 });
  try {
    await sandbox.setup();
    const result = await sandbox.exec("sleep 5");
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
  } finally {
    await sandbox.cleanup();
  }
});

test("MemorySandbox warm is a no-op", async () => {
  const sandbox = new MemorySandbox();
  await sandbox.warm();
  assert.equal(sandbox.toolCalls, 0);
});

test("LocalSandbox warm skips repositories without package.json", async () => {
  const root = path.join(os.tmpdir(), `cortado-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandbox = new LocalSandbox({ root, files: { "src/a.ts": "a" }, warmDependencies: true });
  try {
    await sandbox.setup();
    await sandbox.warm();
    assert.equal(sandbox.toolCalls, 0);
  } finally {
    await sandbox.cleanup();
  }
});

test("LocalSandbox warm is a no-op when warm dependencies is disabled", async () => {
  const root = path.join(os.tmpdir(), `cortado-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandbox = new LocalSandbox({ root, files: { "package.json": "{}" } });
  try {
    await sandbox.setup();
    await sandbox.warm();
    assert.equal(sandbox.toolCalls, 0);
  } finally {
    await sandbox.cleanup();
  }
});

test("LocalSandbox cleanup removes the root directory", async () => {
  const root = path.join(os.tmpdir(), `cortado-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const sandbox = new LocalSandbox({ root, files: {} });
  await sandbox.setup();
  await sandbox.cleanup();
  await assert.rejects(() => fs.access(root));
});
