import { test } from "node:test";
import assert from "node:assert/strict";
import { detectRuntime, type RuntimeCapability } from "../../src/context/runtime";
import { probeCommand, runArtifact } from "../../src/artifact";
import { investigateStage } from "../../src/stages/investigate";
import { planStage } from "../../src/stages/plan";
import { MemorySandbox } from "../../src/sandbox-memory";
import type { ExecResult, ReproArtifact } from "../../src/types";
import type { Logger } from "../../src/util";
import { makeRequest, makeRouter, ScriptedClient } from "./helpers";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

function ok(command: string): ExecResult {
  return { command, exitCode: 0, stdout: "", stderr: "", durationMs: 1, timedOut: false };
}

function fail(command: string, stderr: string): ExecResult {
  return { command, exitCode: 1, stdout: "", stderr, durationMs: 1, timedOut: false };
}

function uiRequest() {
  const request = makeRequest();
  request.anchors = { "package.json": JSON.stringify({ scripts: { dev: "vite" }, dependencies: { react: "^18.0.0" } }) };
  request.repoFiles = ["vite.config.ts", "client/src/main.tsx", "client/src/pages/Billing.tsx"];
  request.graph = {
    files: [
      { path: "vite.config.ts", kind: "config" },
      { path: "client/src/pages/Billing.tsx", kind: "source" },
    ],
    connections: [],
    symbols: [],
    symbolEdges: [],
    strings: [],
  };
  request.files = [
    {
      path: "client/src/pages/Billing.tsx",
      status: "modified",
      content: "export default function Billing(){ return null }",
      patch: "@@ -1,1 +1,2 @@\n+export default function Billing(){ return null }\n",
      additions: 1,
      deletions: 0,
    },
  ];
  return request;
}

test("a changed page with a dev script enables the UI surface and generates a browser scenario", () => {
  const request = uiRequest();
  const plan = planStage(request);
  const capability = detectRuntime(request, plan.context);
  assert.equal(capability.enabled, true);
  assert.deepEqual(capability.surfaces, ["ui"]);
  assert.equal(capability.seeds.length, 1);
  const seed = capability.seeds[0];
  assert.equal(seed.surface, "ui");
  assert.match(seed.script, /require\("playwright"\)/);
  assert.match(seed.claim, /\/billing/);
  assert.equal(seed.setup.length, 2, "scene setup starts the dev server and waits for it");
  assert.ok(seed.teardown.length > 0);
  assert.match(probeCommand(`.cortado-probes/${seed.scriptName}`, seed.script), /PLAYWRIGHT_BROWSERS_PATH/);
});

test("a changed express route enables the API surface with an HTTP scenario", () => {
  const request = makeRequest();
  request.anchors = { "package.json": JSON.stringify({ scripts: { dev: "tsx server/index.ts" }, dependencies: { express: "^5.0.0" } }) };
  request.repoFiles = ["server/index.ts", "server/routes.ts"];
  request.graph = { files: [{ path: "server/routes.ts", kind: "source" }], connections: [], symbols: [], symbolEdges: [], strings: [] };
  request.files = [
    {
      path: "server/routes.ts",
      status: "modified",
      content: 'router.get("/items", async (req, res) => { res.json(await listItems()); });\n',
      patch: '@@ -1,1 +1,2 @@\n+router.get("/items", async (req, res) => { res.json(await listItems()); });\n',
      additions: 1,
      deletions: 0,
    },
  ];
  const plan = planStage(request);
  const capability = detectRuntime(request, plan.context);
  assert.equal(capability.enabled, true);
  assert.deepEqual(capability.surfaces, ["api"]);
  assert.equal(capability.seeds[0].surface, "api");
  assert.match(capability.seeds[0].claim, /GET \/items/);
  assert.match(capability.seeds[0].script, /status >= 500/);
});

test("a changed CLI entry enables the CLI surface", () => {
  const request = makeRequest();
  request.anchors = { "package.json": JSON.stringify({ name: "tool", bin: { tool: "./bin/cli.js" } }) };
  request.repoFiles = ["bin/cli.js"];
  request.graph = { files: [{ path: "bin/cli.js", kind: "source" }], connections: [], symbols: [], symbolEdges: [], strings: [] };
  request.files = [{ path: "bin/cli.js", status: "modified", content: "console.log('cli');\n", patch: "@@ -1,1 +1,2 @@\n+console.log('cli');\n", additions: 1, deletions: 0 }];
  const plan = planStage(request);
  const capability = detectRuntime(request, plan.context);
  assert.equal(capability.enabled, true);
  assert.deepEqual(capability.surfaces, ["cli"]);
  assert.equal(capability.seeds[0].surface, "cli");
});

test("a repo with no runnable surface is skipped with a reason, and the setting can disable runtime", () => {
  const request = makeRequest();
  const plan = planStage(request);
  const capability = detectRuntime(request, plan.context);
  assert.equal(capability.enabled, false);
  assert.match(capability.reason ?? "", /no runnable surface/);

  const disabled = uiRequest();
  disabled.settings = { ...disabled.settings, runtime: false };
  const disabledCapability = detectRuntime(disabled, planStage(disabled).context);
  assert.equal(disabledCapability.enabled, false);
  assert.match(disabledCapability.reason ?? "", /disabled/);
});

test("CORTADO_RUNTIME=0 disables runtime exercise globally", () => {
  const previous = process.env.CORTADO_RUNTIME;
  process.env.CORTADO_RUNTIME = "0";
  try {
    const request = uiRequest();
    const capability = detectRuntime(request, planStage(request).context);
    assert.equal(capability.enabled, false);
    assert.match(capability.reason ?? "", /CORTADO_RUNTIME/);
  } finally {
    if (previous === undefined) delete process.env.CORTADO_RUNTIME;
    else process.env.CORTADO_RUNTIME = previous;
  }
});

async function artifactScenario(handler: (command: string, calls: number) => ExecResult) {
  const commands: string[] = [];
  let calls = 0;
  const sandbox = new MemorySandbox({
    exec: (command) => {
      commands.push(command);
      calls += 1;
      return handler(command, calls);
    },
  });
  const artifact: ReproArtifact = {
    path: "repro.mjs",
    command: "node .cortado-probes/repro.mjs",
    content: "console.error('billing broke'); process.exit(1);",
    hash: "h",
    failures: 0,
    surface: "logic",
    setup: ["start-app"],
    teardown: ["stop-app"],
  };
  return { sandbox, artifact, commands };
}

test("runArtifact orders setup, two runs and teardown", async () => {
  const { sandbox, artifact, commands } = await artifactScenario((command) =>
    command.startsWith("node ") ? fail(command, "billing broke") : ok(command),
  );
  const result = await runArtifact(sandbox, artifact, `${sandbox.root}/.cortado-probes`, { runs: 2, expect: "fail", target: "billing" });
  assert.equal(result.passed, true);
  assert.equal(result.harnessError, false);
  assert.deepEqual(commands, ["start-app", "node .cortado-probes/repro.mjs", "node .cortado-probes/repro.mjs", "stop-app"]);
});

test("a setup failure is a harness error and teardown still runs", async () => {
  const { sandbox, artifact, commands } = await artifactScenario((command) =>
    command === "start-app" ? fail(command, "dev server did not start") : ok(command),
  );
  const result = await runArtifact(sandbox, artifact, `${sandbox.root}/.cortado-probes`, { runs: 2, expect: "fail" });
  assert.equal(result.passed, false);
  assert.equal(result.harnessError, true);
  assert.deepEqual(commands, ["start-app", "stop-app"]);
});

test("a flaky scenario (one fail, one pass) is not a reproduction", async () => {
  let runs = 0;
  const { sandbox, artifact } = await artifactScenario((command) => {
    if (command.startsWith("node ")) {
      runs += 1;
      return runs === 1 ? fail(command, "billing broke") : ok(command);
    }
    return ok(command);
  });
  const result = await runArtifact(sandbox, artifact, `${sandbox.root}/.cortado-probes`, { runs: 2, expect: "fail", target: "billing" });
  assert.equal(result.passed, false);
  assert.equal(result.failures, 1);
});

test("probeCommand only adds the browser env for Playwright scripts", () => {
  assert.equal(probeCommand(".cortado-probes/plain.mjs"), "node .cortado-probes/plain.mjs");
  assert.match(probeCommand(".cortado-probes/browser.mjs", 'const { chromium } = require("playwright");'), /^PLAYWRIGHT_BROWSERS_PATH=/);
});

function runtimeCapability(): RuntimeCapability {
  const request = uiRequest();
  const plan = planStage(request);
  return detectRuntime(request, plan.context);
}

test("a seeded runtime regression is reproduced and flagged when the base passes", async () => {
  const request = uiRequest();
  const plan = planStage(request);
  const capability = runtimeCapability();
  assert.equal(capability.enabled, true);
  const sandbox = new MemorySandbox({
    exec: (command) => {
      if (command.includes("runtime-ui")) return fail(command, "runtime errors on /billing:\npageerror: boom");
      return ok(command);
    },
  });
  let baseStatus: "pass" | "fail" = "pass";
  const transport = makeRouter(
    new ScriptedClient("investigator", [{ match: /investigate-.*-t/, responses: [JSON.stringify({ hypotheses: [] })] }]),
    new ScriptedClient("engineer", []),
    new ScriptedClient("reviewer", []),
  );
  const result = await investigateStage({
    sandbox,
    transport,
    context: plan.context,
    logger,
    maxAgents: 5,
    maxHypotheses: 2,
    maxTurns: 2,
    maxToolsPerTurn: 2,
    deadline: Date.now() + 30_000,
    seeds: capability.seeds,
    runtime: capability,
    baseCompare: async () => ({ status: baseStatus, output: baseStatus === "pass" ? "ok" : "same failure" }),
  });
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.state, "reproduced");
  assert.equal(finding.runtime?.surface, "ui");
  assert.equal(finding.runtime?.preExisting, false);
  assert.match(finding.runtime?.baseReason ?? "", /passes on the base/);
  assert.equal(finding.repro.artifact.setup?.length, 2);

  baseStatus = "fail";
  const preExisting = await investigateStage({
    sandbox: new MemorySandbox({ exec: (command) => (command.includes("runtime-ui") ? fail(command, "runtime errors on /billing:\npageerror: boom") : ok(command)) }),
    transport: makeRouter(
      new ScriptedClient("investigator", [{ match: /investigate-.*-t/, responses: [JSON.stringify({ hypotheses: [] })] }]),
      new ScriptedClient("engineer", []),
      new ScriptedClient("reviewer", []),
    ),
    context: plan.context,
    logger,
    maxAgents: 5,
    maxHypotheses: 2,
    maxTurns: 2,
    maxToolsPerTurn: 2,
    deadline: Date.now() + 30_000,
    seeds: capability.seeds,
    runtime: capability,
    baseCompare: async () => ({ status: baseStatus, output: "same failure" }),
  });
  assert.equal(preExisting.findings[0].runtime?.preExisting, true);
  assert.match(preExisting.findings[0].runtime?.baseReason ?? "", /also fails on the base/);
});

test("a seeded runtime failure that cannot run is an error, not a finding", async () => {
  const request = uiRequest();
  const plan = planStage(request);
  const capability = runtimeCapability();
  const sandbox = new MemorySandbox({
    exec: (command) => {
      if (command.includes("runtime-ui")) return fail(command, "Cannot find module 'playwright'");
      return ok(command);
    },
  });
  const result = await investigateStage({
    sandbox,
    transport: makeRouter(
      new ScriptedClient("investigator", [{ match: /investigate-.*-t/, responses: [JSON.stringify({ hypotheses: [] })] }]),
      new ScriptedClient("engineer", []),
      new ScriptedClient("reviewer", []),
    ),
    context: plan.context,
    logger,
    maxAgents: 5,
    maxHypotheses: 2,
    maxTurns: 2,
    maxToolsPerTurn: 2,
    deadline: Date.now() + 30_000,
    seeds: capability.seeds,
    runtime: capability,
  });
  assert.equal(result.findings.length, 0);
  assert.equal(result.candidates[0].state, "error");
});

export type { RuntimeCapability };
