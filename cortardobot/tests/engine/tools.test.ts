import { test } from "node:test";
import assert from "node:assert/strict";
import { executeTool, probeCommand, ENGINEER_TOOLS, INVESTIGATOR_TOOLS, RESEARCHER_TOOLS } from "../../src/agent/tools";
import type { ToolContext } from "../../src/agent/tools";
import { GraphIndex } from "../../src/context/graph";
import { deriveContext } from "../../src/context/pack";
import { makeRequest, makeSandbox, makeExecHandler, REPRO_SCRIPT, BUGGY_BILLING } from "./helpers";

function contextFor(sandbox: ReturnType<typeof makeSandbox>): ToolContext {
  const request = makeRequest();
  const graph = new GraphIndex(request.graph);
  graph.overlay("src/billing.ts", BUGGY_BILLING);
  const context = deriveContext(request, graph, { packageManager: "npm", hasNodeModules: true, testFiles: [], scripts: {} });
  return {
    sandbox,
    graph,
    context,
    profile: context.profile,
    probeDir: `${sandbox.root}/.cortado-probes`,
    phase: "test",
    logger: { debug() {}, info() {}, warn() {}, error() {} } as unknown as ToolContext["logger"],
  };
}

test("probe commands use a pinned runtime, never the repository test framework", () => {
  assert.equal(probeCommand(".cortado-probes/repro.mjs"), "node .cortado-probes/repro.mjs");
  assert.equal(probeCommand(".cortado-probes/repro.py"), "python3 .cortado-probes/repro.py");
  assert.equal(probeCommand(".cortado-probes/repro.sh"), "bash .cortado-probes/repro.sh");
  assert.ok(probeCommand(".cortado-probes/repro.ts").includes("tsx"));
  for (const command of [".mjs", ".ts", ".py", ".sh"].map((extension) => probeCommand(`.cortado-probes/repro${extension}`))) {
    assert.ok(!/vitest|jest|npm test/.test(command), `must not fall back to a test framework: ${command}`);
  }
});

test("run_probe executes the script and records the failure", async () => {
  const sandbox = makeSandbox();
  const ctx = contextFor(sandbox);
  const probes: Array<{ name: string; passed: boolean; command: string }> = [];
  ctx.recordProbe = (probe) => probes.push({ name: probe.name, passed: probe.passed, command: probe.command });

  const write = await executeTool({ tool: "write_probe", args: { name: "repro.mjs", content: REPRO_SCRIPT } }, ctx);
  assert.equal(write.ok, true);
  const run = await executeTool({ tool: "run_probe", args: { name: "repro.mjs" } }, ctx);
  assert.equal(run.ok, false, "the probe must fail while the defect exists");
  assert.equal(probes.length, 1);
  assert.equal(probes[0].passed, false);
  assert.ok(probes[0].command.startsWith("node "));
});

test("phase tool policies keep investigators read-only for project files", () => {
  assert.ok(INVESTIGATOR_TOOLS.has("read_file"));
  assert.ok(INVESTIGATOR_TOOLS.has("run_probe"));
  assert.ok(!INVESTIGATOR_TOOLS.has("edit_file"));
  assert.ok(!INVESTIGATOR_TOOLS.has("write_file"));
  assert.ok(!INVESTIGATOR_TOOLS.has("run_command"));
  assert.ok(ENGINEER_TOOLS.has("edit_file"));
  assert.ok(ENGINEER_TOOLS.has("run_command"));
  assert.ok(!RESEARCHER_TOOLS.has("write_probe"));
  assert.ok(!RESEARCHER_TOOLS.has("run_command"));
});

test("edit_file refuses ambiguous or missing find text", async () => {
  const sandbox = makeSandbox();
  const ctx = contextFor(sandbox);
  const ambiguous = await executeTool({ tool: "edit_file", args: { path: "src/billing.ts", find: "store", replace: "cache" } }, ctx);
  assert.equal(ambiguous.ok, false);
  const missing = await executeTool({ tool: "edit_file", args: { path: "src/billing.ts", find: "not there", replace: "x" } }, ctx);
  assert.equal(missing.ok, false);
  const missingFile = await executeTool({ tool: "edit_file", args: { path: "src/nope.ts", find: "a", replace: "b" } }, ctx);
  assert.equal(missingFile.ok, false);
});

test("run_command executes in the sandbox and reports the exit code", async () => {
  const sandbox = makeSandbox({ exec: makeExecHandler() });
  const ctx = contextFor(sandbox);
  const result = await executeTool({ tool: "run_command", args: { command: "npx tsc --noEmit" } }, ctx);
  assert.equal(result.ok, true);
});
