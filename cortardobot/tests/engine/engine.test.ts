import { test } from "node:test";
import assert from "node:assert/strict";
import { createEngine } from "../../src/engine";
import { ENGINE_VERSION } from "../../src/version";
import type { Logger } from "../../src/util";
import {
  BUG_HYPOTHESIS,
  BUG_READ,
  BUG_RUN_PROBE,
  BUG_WRITE_PROBE,
  makeRequest,
  makeRouter,
  makeSandbox,
  ScriptedClient,
} from "./helpers";

const logger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;
const QUIET = { debug() {}, info() {}, warn() {}, error() {} } as unknown as Logger;

function investigatorScript(): ScriptedClient {
  return new ScriptedClient("investigator", [
    { match: /investigate-bug-t/, responses: [BUG_READ, BUG_WRITE_PROBE, BUG_RUN_PROBE, BUG_HYPOTHESIS] },
    { match: /investigate-regression-t/, responses: [JSON.stringify({ hypotheses: [] })] },
  ]);
}

function engineerScript(): ScriptedClient {
  return new ScriptedClient("engineer", [
    {
      match: /fix-.*-a1-t/,
      responses: [
        JSON.stringify({
          thought: "write the plan under a dedicated key",
          actions: [
            {
              tool: "edit_file",
              args: {
                path: "src/billing.ts",
                find: 'store.setItem("ag.activeWorkspaceId", plan);',
                replace: 'store.setItem("ag.activePlan", plan);',
              },
            },
          ],
          done: false,
        }),
        JSON.stringify({ done: true, summary: "writes the plan to ag.activePlan" }),
      ],
    },
  ]);
}

function reviewerScript(): ScriptedClient {
  return new ScriptedClient("reviewer", [
    { match: /^verify-/, responses: [JSON.stringify({ approved: true, risk: "low", confidence: 0.9, summary: "the patch addresses the claimed cause" })] },
    { match: /^report$/, responses: [JSON.stringify({ decision: "approve_with_comments", confidence: 0.85, summary: "One verified fix.", rationale: "The reproduced defect is fixed and verified." })] },
  ]);
}

test("a reproduced defect goes through fix and independent verification", async () => {
  const sandboxFactoryCalls: number[] = [];
  const engine = createEngine({
    transport: makeRouter(investigatorScript(), engineerScript(), reviewerScript()),
    sandboxFactory: async () => {
      sandboxFactoryCalls.push(1);
      return makeSandbox();
    },
    verificationSandboxFactory: async () => makeSandbox(),
    logger: QUIET,
  });

  const result = await engine.run(makeRequest());
  assert.equal(result.status, "done");
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].state, "verified_fix");
  assert.equal(result.summary.issuesReproduced, 1);
  assert.equal(result.summary.issuesVerified, 1);
  assert.equal(result.summary.issuesFixed, result.summary.issuesVerified);
  assert.equal(result.candidates.find((entry) => entry.state === "verified_fix")?.candidateId, result.findings[0].id);
  assert.ok(result.findings[0].fix?.verification?.passed);
  assert.equal(result.findings[0].fix?.reviewer?.approved, true);
  assert.ok(result.report.verified.length === 1);
  assert.equal(result.report.verdict.decision, "approve_with_comments");
  assert.equal(result.models.engineer.length > 0, true);
  assert.equal(ENGINE_VERSION, "3.5.0");
  assert.ok(sandboxFactoryCalls.length >= 1);
});

test("a clean pull request never starts a sandbox", async () => {
  let sandboxes = 0;
  const clean = new ScriptedClient("investigator", [
    { match: /investigate-bug-t/, responses: [JSON.stringify({ hypotheses: [] })] },
    { match: /investigate-regression-t/, responses: [JSON.stringify({ hypotheses: [] })] },
  ]);
  const cleanReviewer = new ScriptedClient("reviewer", [
    { match: /^report$/, responses: [JSON.stringify({ decision: "approve", confidence: 0.9, summary: "No defect was reproduced.", rationale: "The reproduction gate found nothing." })] },
  ]);
  const engine = createEngine({
    transport: makeRouter(clean, engineerScript(), cleanReviewer),
    sandboxFactory: async () => {
      sandboxes += 1;
      return makeSandbox();
    },
    logger: QUIET,
  });
  const result = await engine.run(makeRequest());
  assert.equal(result.status, "done");
  assert.equal(result.findings.length, 0);
  assert.equal(sandboxes, 0, "a review with no reproduced defect must not provision E2B");
  assert.equal(result.report.verdict.decision, "approve");
  assert.equal(result.summary.issuesVerified, 0);
});

test("an exhausted model budget defers findings but the run still completes", async () => {
  // Investigation needs 6 calls (bug reads/reproduces over 4 turns, regression
  // and security one each). Setting the ceiling to exactly 6 leaves nothing for
  // repair, so the reproduced finding must be deferred, not lost or failed.
  const engine = createEngine({
    transport: makeRouter(investigatorScript(), engineerScript(), reviewerScript(), 6),
    sandboxFactory: async () => makeSandbox(),
    logger: QUIET,
  });
  const result = await engine.run(makeRequest());
  assert.equal(result.status, "done", "a budget stop must not fail the run");
  assert.equal(result.degraded, true);
  assert.match(result.degradedReason ?? "", /deferred/);
  const deferred = result.candidates.find((entry) => entry.state === "deferred");
  assert.ok(deferred, "the finding is deferred, not lost");
  assert.equal(result.summary.deferred >= 1, true);
  assert.ok(result.report.verdict.decision === "request_changes" || result.report.verdict.decision === "approve_with_comments");
  assert.equal(result.findings.length, 1, "the reproduced finding is still reported");
});

test("a runtime regression is exercised, fixed and verified end to end", async () => {
  const request = makeRequest();
  request.anchors = { "package.json": JSON.stringify({ scripts: { dev: "vite" }, dependencies: { react: "^18.0.0" } }) };
  request.repoFiles = ["vite.config.ts", "client/src/pages/Billing.tsx"];
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
      content: "export default function Billing(){ const plan = CRASH; return plan }",
      patch: "@@ -1,1 +1,2 @@\n+export default function Billing(){ const plan = CRASH; return plan }\n",
      additions: 1,
      deletions: 0,
    },
  ];

  let onBase = false;
  const makeHandler = () => (command: string, sandbox: ReturnType<typeof makeSandbox>) => {
    const base = { command, stdout: "", stderr: "", durationMs: 1, timedOut: false };
    if (command.includes("git checkout --quiet --force base")) {
      onBase = true;
      return { ...base, exitCode: 0 };
    }
    if (command.includes("git checkout --quiet --force head")) {
      onBase = false;
      return { ...base, exitCode: 0 };
    }
    if (command.includes("runtime-ui")) {
      if (onBase) return { ...base, exitCode: 0, stdout: "ok" };
      const content = sandbox.snapshot()["client/src/pages/Billing.tsx"] ?? "";
      if (content.includes("CRASH")) return { ...base, exitCode: 1, stderr: "runtime errors on /billing:\npageerror: CRASH is not defined" };
      return { ...base, exitCode: 0, stdout: "ok" };
    }
    return { ...base, exitCode: 0 };
  };

  const engineer = new ScriptedClient("engineer", [
    {
      match: /fix-.*-a1-t/,
      responses: [
        JSON.stringify({
          thought: "fix the runtime crash",
          actions: [{ tool: "edit_file", args: { path: "client/src/pages/Billing.tsx", find: "const plan = CRASH", replace: "const plan = null" } }],
          done: false,
        }),
        JSON.stringify({ done: true, summary: "the page no longer crashes" }),
      ],
    },
  ]);
  const emptyInvestigator = new ScriptedClient("investigator", [{ match: /investigate-.*-t/, responses: [JSON.stringify({ hypotheses: [] })] }]);

  const engine = createEngine({
    transport: makeRouter(emptyInvestigator, engineer, reviewerScript()),
    sandboxFactory: async () =>
      makeSandbox({
        files: {
          "client/src/pages/Billing.tsx": "export default function Billing(){ const plan = CRASH; return plan }",
          "vite.config.ts": "export default {};",
          "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
        },
        typecheck: false,
        tests: false,
        exec: makeHandler(),
      }),
    verificationSandboxFactory: async () =>
      makeSandbox({
        files: {
          "client/src/pages/Billing.tsx": "export default function Billing(){ const plan = CRASH; return plan }",
          "vite.config.ts": "export default {};",
          "package.json": JSON.stringify({ scripts: { dev: "vite" } }),
        },
        typecheck: false,
        tests: false,
        exec: makeHandler(),
      }),
    logger: QUIET,
  });

  const result = await engine.run(request);
  assert.equal(result.status, "done");
  assert.equal(result.report.runtime?.status, "exercised");
  assert.deepEqual(result.report.runtime?.surfaces, ["ui"]);
  assert.equal(result.findings.length, 1);
  const finding = result.findings[0];
  assert.equal(finding.runtime?.surface, "ui");
  assert.equal(finding.runtime?.preExisting, false);
  assert.equal(finding.state, "verified_fix");
  assert.equal(finding.repro.artifact.setup?.length, 2);
  assert.equal(result.summary.issuesVerified, 1);
});

test("an edit that weakens types is rejected as unsafe before verification", async () => {
  const engineer = new ScriptedClient("engineer", [
    {
      match: /fix-.*-a1-t/,
      responses: [
        JSON.stringify({
          thought: "silence the type error",
          actions: [
            {
              tool: "edit_file",
              args: {
                path: "src/billing.ts",
                find: 'store.setItem("ag.activeWorkspaceId", plan);',
                replace: 'store.setItem("ag.activeWorkspaceId", plan as any);',
              },
            },
          ],
          done: false,
        }),
        JSON.stringify({ done: true, summary: "suppressed the type error" }),
      ],
    },
  ]);
  const engine = createEngine({
    transport: makeRouter(investigatorScript(), engineer, reviewerScript()),
    sandboxFactory: async () => makeSandbox(),
    logger: QUIET,
  });
  const result = await engine.run(makeRequest());
  assert.equal(result.findings[0].state, "fix_failed");
  assert.equal(result.findings[0].fix?.attempts[0].failureCategory, "unsafe_edit");
  assert.match(result.findings[0].fix?.attempts[0].failureDetail ?? "", /suppression/);
});

test("a sandbox that cannot start degrades the run instead of crashing it", async () => {
  const engine = createEngine({
    transport: makeRouter(investigatorScript(), engineerScript(), reviewerScript()),
    sandboxFactory: async () => {
      throw new Error("E2B is unavailable");
    },
    logger: QUIET,
  });
  const result = await engine.run(makeRequest());
  assert.equal(result.status, "done", "infrastructure failure must not throw away the run");
  assert.equal(result.degraded, true);
  assert.match(result.degradedReason ?? "", /sandbox unavailable/);
  assert.notEqual(result.report.verdict.decision, "approve", "a degraded run never approves");
});

test("no api key ever appears in the engine result", async () => {
  const engine = createEngine({
    transport: makeRouter(investigatorScript(), engineerScript(), reviewerScript()),
    sandboxFactory: async () => makeSandbox(),
    verificationSandboxFactory: async () => makeSandbox(),
    logger: QUIET,
  });
  const result = await engine.run(makeRequest());
  const serialized = JSON.stringify(result);
  assert.ok(!/"apiKey"|"baseUrl"|mg_/.test(serialized), "the result must never carry the gateway key");
});

export { logger };
