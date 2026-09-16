import assert from "node:assert/strict";
import { test } from "node:test";
import { CortadoV3Engine } from "../../src/v3/engine.ts";
import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import { MemoryCacheStore } from "../../src/v3/cache/memory-store.ts";
import { ModelRouter } from "../../src/v3/models.ts";
import { resolveV3Config } from "../../src/v3/config.ts";
import { judgeCandidates } from "../../src/v3/judge.ts";
import { finalReview } from "../../src/v3/astra.ts";
import { buildContextPack, buildSwarmContext, renderContextPack, renderSwarmContext } from "../../src/v3/agent/context-pack.ts";
import { normalizeLearnings, renderLearnings } from "../../src/v3/util.ts";
import { candidate, contextWith, proof, scriptedClient, silentLogger } from "./helpers.ts";
import type { ModelClient, ModelTask, ReviewRequest } from "../../src/v3/types.ts";

const profile = { packageManager: "npm" as const, installCommand: "npm ci", hasNodeModules: false, hasTests: false, scripts: {} };

test("normalizeLearnings trims, dedupes, truncates and bounds the list", () => {
  const input = Array.from({ length: 25 }, (_, index) => `  learning ${index}  `);
  input.push("LEARNING 0");
  const items = normalizeLearnings(input);
  assert.equal(items.length, 20);
  assert.equal(items[0], "learning 0");
  assert.deepEqual(normalizeLearnings(undefined), []);
  assert.deepEqual(normalizeLearnings(["", "   "]), []);
  assert.equal(normalizeLearnings(["x".repeat(400)])[0].length, 300);
  assert.equal(renderLearnings([]), undefined);
  assert.match(renderLearnings(["use zod for input validation"]) ?? "", /- use zod for input validation/);
});

test("context packs carry learnings, hash them and render them for agents", async () => {
  const files = { "src/a.ts": "export const a = 1;\n" };
  const sandbox = new MemorySandbox({ files });
  const context = contextWith([{ path: "src/a.ts", content: files["src/a.ts"] }], { learnings: ["never change the public API"] });

  const swarmPack = await buildSwarmContext({ context, sandbox, profile });
  assert.deepEqual(swarmPack.learnings, ["never change the public API"]);
  assert.match(renderSwarmContext(swarmPack), /### Repository learnings \(follow these\)\n- never change the public API/);

  const withoutLearnings = await buildSwarmContext({ context: contextWith([{ path: "src/a.ts", content: files["src/a.ts"] }]), sandbox, profile });
  assert.notEqual(swarmPack.hash, withoutLearnings.hash, "learnings change the pack hash");

  const c = candidate();
  const pack = await buildContextPack({ candidate: c, context, sandbox, profile, proof: proof(c) });
  assert.deepEqual(pack.learnings, ["never change the public API"]);
  assert.match(renderContextPack(pack), /### Repository learnings \(follow these\)\n- never change the public API/);
});

test("judge and astra prompts include repository learnings", async () => {
  const terra = scriptedClient("terra", () =>
    JSON.stringify({ decisions: [{ candidateId: "c_test01", verdict: "STATIC_ONLY", reason: "low value", priority: 1 }] }),
  );
  const terraRouter = new ModelRouter({ clients: { terra }, config: resolveV3Config().models, maxCalls: 5 });
  await judgeCandidates([candidate()], contextWith([], { learnings: ["prefer async/await over callbacks"] }), terraRouter, silentLogger, 1);
  assert.match(terra.calls[0].user, /prefer async\/await over callbacks/);

  const astra = scriptedClient("astra", (task: ModelTask) => {
    const ids = [...task.user.matchAll(/## Finding (\S+)/g)].map((match) => match[1]);
    return JSON.stringify({
      reviews: ids.map((candidateId) => ({ candidateId, validity: "valid", fixCorrectness: "correct", risk: "low", approval: "approve", confidence: 0.9, summary: "ok" })),
    });
  });
  const astraRouter = new ModelRouter({ clients: { astra }, config: resolveV3Config().models, maxCalls: 5 });
  const c = candidate();
  await finalReview(
    { items: [{ candidate: c, proof: proof(c) }], context: contextWith([], { learnings: ["no new runtime dependencies"] }), learnings: ["no new runtime dependencies"] },
    astraRouter,
    silentLogger,
  );
  assert.match(astra.calls[0].user, /no new runtime dependencies/);
});

test("learnings reach the swarm prompt and invalidate cached swarm context", async () => {
  const files = { "src/a.ts": "export const a = 1;\n" };
  const cache = new MemoryCacheStore();
  const luna = scriptedClient("luna", () => JSON.stringify({ hypotheses: [] }));
  const terra = scriptedClient("terra", () => JSON.stringify({ decisions: [] }));
  const astra = scriptedClient("astra", () => JSON.stringify({ reviews: [] }));
  const model: ModelClient = {
    id: "combined-learnings",
    async complete(task: ModelTask) {
      return (task.role === "luna" ? luna : task.role === "astra" ? astra : terra).complete(task);
    },
  };
  const request = (learnings: string[]): ReviewRequest => ({
    runId: `run-learnings-${learnings[0]}`,
    repo: { fullName: "acme/repo", defaultBranch: "main", installationId: 1, cloneUrl: "x", token: "x" },
    pr: { number: 1, title: "tiny change", body: "", baseSha: "base", headSha: "head", baseBranch: "main", headBranch: "feature" },
    files: [{ path: "src/a.ts", status: "modified", content: files["src/a.ts"] }],
    learnings,
  });
  const run = (learnings: string[]) =>
    new CortadoV3Engine({
      config: { mode: "live" },
      models: { luna: model, terra: model, codegen: model, astra: model },
      sandboxFactory: async () => new MemorySandbox({ files }),
      cache,
      logger: silentLogger,
    }).run(request(learnings));

  const first = await run(["always add a regression test"]);
  assert.equal(first.status, "completed");
  assert.ok(luna.calls.every((call) => call.user.includes("always add a regression test")));
  const callsAfterFirst = luna.calls.length;

  const second = await run(["always update the changelog"]);
  assert.equal(second.status, "completed");
  assert.ok(luna.calls.slice(callsAfterFirst).every((call) => call.user.includes("always update the changelog")));
  assert.ok(second.events.some((event) => event.stage === "swarm_context" && event.detail?.includes("cache hit")) === false, "changed learnings bypass the cached swarm context");
});
