import { test } from "node:test";
import assert from "node:assert/strict";
import { investigateStage, selectInvestigators } from "../../src/stages/investigate";
import { planStage } from "../../src/stages/plan";
import type { Logger } from "../../src/util";
import {
  BUG_HYPOTHESIS,
  BUG_READ,
  BUG_RUN_PROBE,
  BUG_WRITE_PROBE,
  makeExecHandler,
  makeRequest,
  makeRouter,
  makeSandbox,
  ScriptedClient,
} from "./helpers";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

function setup(investigator: ScriptedClient, sandbox = makeSandbox()) {
  const request = makeRequest();
  const plan = planStage(request);
  return {
    sandbox,
    plan,
    deps: {
      sandbox,
      transport: makeRouter(investigator, new ScriptedClient("engineer", []), new ScriptedClient("reviewer", [])),
      context: plan.context,
      logger,
      maxAgents: 2,
      maxHypotheses: 2,
      maxTurns: 5,
      maxToolsPerTurn: 4,
      deadline: Date.now() + 60_000,
    },
  };
}

function bugInvestigator(): ScriptedClient {
  return new ScriptedClient("investigator", [
    { match: /investigate-bug-t/, responses: [BUG_READ, BUG_WRITE_PROBE, BUG_RUN_PROBE, BUG_HYPOTHESIS] },
    { match: /investigate-regression-t/, responses: [JSON.stringify({ hypotheses: [] })] },
  ]);
}

test("an investigator that reads the file and reproduces the defect produces a finding", async () => {
  const { sandbox, plan, deps } = setup(bugInvestigator());
  const result = await investigateStage(deps);
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.state, "reproduced");
  assert.equal(finding.severity, "high");
  assert.equal(finding.repro.artifact.failures, 2, "the reproduction must fail twice");
  assert.equal(finding.repro.artifact.path, "repro.mjs");
  assert.ok(finding.repro.output.includes("billing.ts"));
  assert.ok(result.candidates.some((entry) => entry.state === "reproduced"));
  const probe = sandbox.snapshot()[".cortado-probes/repro.mjs"];
  assert.ok(probe?.includes("readFileSync"), "the probe was written to the sandbox");
});

test("a claim made without reading the file is dropped", async () => {
  const investigator = new ScriptedClient("investigator", [
    { match: /investigate-bug-t/, responses: [BUG_HYPOTHESIS] },
    { match: /investigate-regression-t/, responses: [JSON.stringify({ hypotheses: [] })] },
  ]);
  const { plan, deps } = setup(investigator);
  const result = await investigateStage(deps);
  assert.equal(result.findings.length, 0);
  const dropped = result.candidates.find((entry) => entry.state === "not_reproduced");
  assert.ok(dropped);
  assert.match(dropped.reason, /without reading/);
});

test("a probe that never ran is recorded as an error, not a finding", async () => {
  const brokenProbe = 'import { run } from "./missing-helper.mjs";\nrun();\n';
  const investigator = new ScriptedClient("investigator", [
    {
      match: /investigate-bug-t/,
      responses: [
        BUG_READ,
        JSON.stringify({ actions: [{ tool: "write_probe", args: { name: "repro.mjs", content: brokenProbe } }], done: false }),
        BUG_RUN_PROBE,
        BUG_HYPOTHESIS,
      ],
    },
    { match: /investigate-regression-t/, responses: [JSON.stringify({ hypotheses: [] })] },
  ]);
  const sandbox = makeSandbox({
    exec: async (command, box) => {
      if (command.includes("repro.mjs")) {
        return { command, exitCode: 1, stdout: "", stderr: "Error: Cannot find module './missing-helper.mjs'", durationMs: 1, timedOut: false };
      }
      return makeExecHandler()(command, box);
    },
  });
  const { plan, deps } = setup(investigator, sandbox);
  const result = await investigateStage(deps);
  assert.equal(result.findings.length, 0);
  const errored = result.candidates.find((entry) => entry.state === "error");
  assert.ok(errored, "harness failures must be recorded as errors");
  assert.match(errored.reason, /could not run/);
});

test("a probe that passes is not a reproduction", async () => {
  const investigator = new ScriptedClient("investigator", [
    { match: /investigate-bug-t/, responses: [BUG_READ, BUG_WRITE_PROBE, BUG_RUN_PROBE, BUG_HYPOTHESIS] },
    { match: /investigate-regression-t/, responses: [JSON.stringify({ hypotheses: [] })] },
  ]);
  const sandbox = makeSandbox({ source: "export const plan = true;\n" });
  const { deps } = setup(investigator, sandbox);
  const result = await investigateStage(deps);
  assert.equal(result.findings.length, 0);
  const dropped = result.candidates.find((entry) => entry.state === "not_reproduced");
  assert.ok(dropped);
  assert.match(dropped.reason, /passed/);
});

test("investigator selection matches the diff", () => {
  const request = makeRequest();
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
  const plan = planStage(request);
  const specs = selectInvestigators(plan.context, 5).map((spec) => spec.id);
  assert.ok(specs.includes("bug"));
  assert.ok(specs.includes("ui"), "a .tsx change selects the UI investigator");
});
