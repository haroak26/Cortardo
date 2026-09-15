import assert from "node:assert/strict";
import { test } from "node:test";
import { CortadoV3Engine } from "../../src/v3/engine.ts";
import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import { MemoryCacheStore } from "../../src/v3/cache/memory-store.ts";
import { scriptedClient, silentLogger } from "./helpers.ts";
import { authContent, docsContent, pricingContent, pr6Files } from "./fixtures/pr6.ts";
import type { BrowserCheck, BrowserCheckResult, ModelClient, ModelTask, ReviewRequest } from "../../src/v3/types.ts";

const edits: Record<string, { path: string; find: string; replace: string }> = {
  "Docs.tsx": {
    path: "client/src/pages/Docs.tsx",
    find: "  const undefinedValue = undefined as any;\n  console.log(undefinedValue.property.nested.value);",
    replace: "",
  },
  "Pricing.tsx": {
    path: "client/src/pages/Pricing.tsx",
    find: "{tiers.filter((_, i) => i !== 1).map((tier, index) => {",
    replace: "{tiers.map((tier, index) => {",
  },
  "Auth.tsx": {
    path: "client/src/pages/Auth.tsx",
    find: 'onClick={() => setLocation("/")}',
    replace: 'onClick={() => setLocation("/auth/register")}',
  },
};

function checkPassed(route: string, files: Record<string, string>): boolean {
  const docs = files["client/src/pages/Docs.tsx"] ?? "";
  const pricing = files["client/src/pages/Pricing.tsx"] ?? "";
  const auth = files["client/src/pages/Auth.tsx"] ?? "";
  if (route === "/docs") return !docs.includes("undefinedValue.property.nested.value");
  if (route === "/pricing") return !pricing.includes(".filter((_, i) => i !== 1)");
  if (route === "/auth") return auth.includes('setLocation("/auth/register")');
  return true;
}

function buildSandbox(files: Record<string, string>) {
  let currentFiles = { ...files };
  const sandbox = new MemorySandbox({
    files,
    profile: { typecheckCommand: "npm run check --silent", devCommand: "npx vite" },
    execHandler: () => ({ exitCode: 0, stdout: "ok" }),
    browserHandler: (checks: Array<{ id: string; check: BrowserCheck }>): BrowserCheckResult[] =>
      checks.map((entry) => {
        const passed = checkPassed(entry.check.path, currentFiles);
        return {
          id: entry.id,
          path: entry.check.path,
          passed,
          pageErrors: passed ? [] : ["TypeError: Cannot read properties of undefined (reading 'property')"],
          consoleErrors: [],
          detail: `assertion ${passed ? "passed" : "failed"} (expected ${entry.check.expected}) at http://memory.local${entry.check.path}`,
          durationMs: 1,
        };
      }),
  });
  const originalApply = sandbox.applyEdits.bind(sandbox);
  sandbox.applyEdits = async (incoming) => {
    const result = await originalApply(incoming);
    currentFiles = Object.fromEntries(await Promise.all((await sandbox.list()).map(async (path) => [path, await sandbox.read(path)] as const)));
    return result;
  };
  return sandbox;
}

function repairScript(): ModelClient {
  const luna = scriptedClient("luna", () => JSON.stringify({ hypotheses: [] }));
  const terra = scriptedClient("terra", (task: ModelTask) => {
    if (task.kind === "judge") return JSON.stringify({ decisions: [] });
    const user = `${task.user}\n${(task.history ?? []).map((message) => message.content).join("\n")}`;
    const match = /### File (client\/src\/pages\/[\w.-]+\.tsx) \(changed\)/.exec(user) ?? /## Source file ([\w./-]+)/.exec(user);
    const name = match?.[1]?.split("/").pop() ?? "";
    const edit = edits[name];
    if (!edit) return JSON.stringify({ thought: "no edit", done: true, summary: "no edit available" });
    return JSON.stringify({ thought: "apply the root-cause fix", strategy: `fix ${name}`, actions: [{ tool: "apply_edit", args: { edits: [edit] } }] });
  });
  const astra = scriptedClient("astra", (task: ModelTask) => {
    const ids = [...task.user.matchAll(/## Finding (\S+)/g)].map((match) => match[1]);
    return JSON.stringify({
      reviews: ids.map((candidateId) => ({ candidateId, validity: "valid", fixCorrectness: "correct", risk: "low", approval: "approve", confidence: 0.9, summary: "verified fix" })),
    });
  });
  return { id: "combined", async complete(task) { return (task.role === "luna" ? luna : task.role === "astra" ? astra : terra).complete(task); } };
}

function request(): ReviewRequest {
  return {
    runId: "run-engine-test",
    repo: { fullName: "haroak26/Artificial-Gateway", defaultBranch: "main", installationId: 1, cloneUrl: "x", token: "x" },
    pr: { number: 6, title: "New pricing page", body: "", baseSha: "base", headSha: "0b19da07", baseBranch: "main", headBranch: "new-pricing-page" },
    files: pr6Files,
  };
}

test("PR6 golden replay: 3 confirmed, 3 verified in one attempt each, real patches", async () => {
  const sandbox = buildSandbox({
    "client/src/pages/Docs.tsx": docsContent,
    "client/src/pages/Pricing.tsx": pricingContent,
    "client/src/pages/Auth.tsx": authContent,
  });
  const model = repairScript();
  const engine = new CortadoV3Engine({
    config: { mode: "live" },
    models: { luna: model, terra: model, astra: model },
    sandboxFactory: async () => sandbox,
    cache: new MemoryCacheStore(),
    logger: silentLogger,
  });
  const result = await engine.run(request());
  assert.equal(result.status, "completed");
  assert.equal(result.summary.issuesConfirmed, 3);
  assert.equal(result.summary.issuesVerified, 3);
  assert.equal(result.summary.issuesFixed, 3);
  assert.equal(result.summary.maxAttempts, 1);
  for (const finding of result.findings) {
    assert.ok(finding.repair?.finalPatch?.includes("@@"), `${finding.candidate.file} patch has hunks`);
    assert.equal(finding.verification?.passed, true);
  }
  assert.equal(result.models.luna, "openai/gpt-5.6-luna");
  assert.equal(result.models.astra, "openai/gpt-6-astra");
  assert.ok(result.swarm, "swarm report is attached");
  assert.equal(result.swarm.mode, "agentic");
  assert.equal(result.swarm.agents.length, 4);
  assert.equal(result.swarm.hypotheses, 0);
  assert.equal(result.swarm.candidates, 0);
});

test("agentic swarm hypotheses flow into candidates and decisions", async () => {
  const sandbox = buildSandbox({
    "client/src/pages/Docs.tsx": docsContent,
    "client/src/pages/Pricing.tsx": pricingContent,
    "client/src/pages/Auth.tsx": authContent,
  });
  const base = repairScript();
  const luna = scriptedClient("luna", (task: ModelTask) =>
    task.label === "luna-bug"
      ? JSON.stringify({
          hypotheses: [
            {
              claim: "Pricing tiers are keyed by array index, so reordering plans misattributes component state",
              evidence: ["client/src/pages/Pricing.tsx:1"],
              severity: "medium",
              confidence: 0.7,
            },
          ],
        })
      : JSON.stringify({ hypotheses: [] }),
  );
  const model: ModelClient = {
    id: "combined-with-luna",
    async complete(task: ModelTask) {
      return task.role === "luna" ? luna.complete(task) : base.complete(task);
    },
  };
  const engine = new CortadoV3Engine({
    config: { mode: "live" },
    models: { luna: model, terra: model, astra: model },
    sandboxFactory: async () => sandbox,
    cache: new MemoryCacheStore(),
    logger: silentLogger,
  });
  const result = await engine.run(request());
  assert.equal(result.status, "completed");
  assert.equal(result.candidates.length, 4, "three detector candidates plus one swarm hypothesis");
  const swarmCandidate = result.candidates.find((candidate) => candidate.source === "luna");
  assert.ok(swarmCandidate, "luna candidate survived the merge");
  assert.equal(swarmCandidate.file, "client/src/pages/Pricing.tsx");
  assert.equal(swarmCandidate.line, 1);
  assert.equal(result.swarm?.hypotheses, 1);
  assert.equal(result.swarm?.candidates, 1);
  const decision = result.decisions.find((entry) => entry.candidateId === swarmCandidate.id);
  assert.equal(decision?.verdict, "STATIC_ONLY");
  assert.equal(result.summary.issuesConfirmed, 3);
  assert.equal(result.summary.issuesVerified, 3);
});

test("repeating the identical run is served from cache with zero model calls", async () => {
  const files = {
    "client/src/pages/Docs.tsx": docsContent,
    "client/src/pages/Pricing.tsx": pricingContent,
    "client/src/pages/Auth.tsx": authContent,
  };
  const cache = new MemoryCacheStore();
  const model = repairScript();
  const first = new CortadoV3Engine({
    config: { mode: "live" },
    models: { luna: model, terra: model, astra: model },
    sandboxFactory: async () => buildSandbox({ ...files }),
    cache,
    logger: silentLogger,
  });
  const firstResult = await first.run(request());
  assert.equal(firstResult.summary.issuesVerified, 3);
  assert.ok(firstResult.summary.modelCalls > 0);

  const second = new CortadoV3Engine({
    config: { mode: "live" },
    models: { luna: model, terra: model, astra: model },
    sandboxFactory: async () => buildSandbox({ ...files }),
    cache,
    logger: silentLogger,
  });
  const secondResult = await second.run(request());
  assert.equal(secondResult.summary.issuesVerified, 3);
  assert.equal(secondResult.summary.modelCalls, 0);
  assert.ok(secondResult.repairs.some((repair) => repair.servedFromCache));
  assert.ok(secondResult.summary.cacheHits > 0);
});

test("deterministic fallback still lands a verified fix when the model gives up", async () => {
  const failing = scriptedClient("terra", () => JSON.stringify({ thought: "give up", done: true, summary: "cannot fix" }));
  const luna = scriptedClient("luna", () => JSON.stringify({ hypotheses: [] }));
  const astra = scriptedClient("astra", () => JSON.stringify({ reviews: [] }));
  const combined: ModelClient = {
    id: "failing",
    async complete(task) {
      return (task.role === "luna" ? luna : task.role === "astra" ? astra : failing).complete(task);
    },
  };
  const sandbox = buildSandbox({
    "client/src/pages/Docs.tsx": docsContent,
    "client/src/pages/Pricing.tsx": pricingContent,
    "client/src/pages/Auth.tsx": authContent,
  });
  const engine = new CortadoV3Engine({
    config: { mode: "live" },
    models: { luna: combined, terra: combined, astra: combined },
    sandboxFactory: async () => sandbox,
    logger: silentLogger,
  });
  const result = await engine.run(request());
  assert.equal(result.summary.issuesConfirmed, 3);
  assert.equal(result.summary.issuesVerified, 3);
  assert.equal(result.summary.maxAttempts, 3);
  assert.equal(result.repairs.length, 3);
  for (const repair of result.repairs) {
    assert.match(repair.attempts[repair.attempts.length - 1]!.strategy, /deterministic/);
  }
});
