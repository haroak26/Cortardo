import assert from "node:assert/strict";
import test from "node:test";
import { DryModel, createDryModel } from "../../src/models/dry";
import { ModelRouter } from "../../src/models/router";
import { OpenAiCompatibleClient } from "../../src/models/live";
import { ModelCallLimitError, type ModelClient, type ModelTask } from "../../src/models/types";
import { creditsFromTokens, resolveConfig } from "../../src/config";
import { contentFile } from "../helpers/factories";
import { extractJson } from "../../src/util/json";

const baseConfig = resolveConfig({ mode: "dry" });

const sqlFile = contentFile(
  "server/users/repo.ts",
  "return db.query(`SELECT * FROM users WHERE id = ${userId}`);",
);

function task(overrides: Partial<ModelTask>): ModelTask {
  return {
    role: overrides.role ?? "luna",
    kind: overrides.kind ?? "swarm_agent",
    system: overrides.system ?? "system",
    user: overrides.user ?? "user",
    expectJson: overrides.expectJson ?? true,
    context: overrides.context ?? {},
  };
}

test("creditsFromTokens converts USD pricing into credits", () => {
  const credits = creditsFromTokens(1_000_000, 1_000_000, {
    ...baseConfig.models,
    inputPricePerMTokens: 2,
    outputPricePerMTokens: 8,
  });
  assert.equal(credits, 10_000);
});

test("DryModel produces parseable swarm hypotheses from files", async () => {
  const model = new DryModel();
  const response = await model.complete(
    task({ context: { agentKind: "database", files: [sqlFile] } }),
  );
  const parsed = extractJson(response.text) as { hypotheses: Array<{ rule?: string; evidence: string[] }> };
  assert.equal(parsed.hypotheses.length, 1);
  assert.equal(parsed.hypotheses[0].rule, "sql-injection");
  assert.deepEqual(parsed.hypotheses[0].evidence, ["server/users/repo.ts:1"]);
  assert.equal(response.durationMs, 1);
  assert.ok(response.tokensIn > 0);
});

test("DryModel swarm returns an empty list when nothing matches", async () => {
  const model = new DryModel();
  const response = await model.complete(
    task({ context: { agentKind: "database", files: [contentFile("src/clean.ts", "const x = 1;")] } }),
  );
  const parsed = extractJson(response.text) as { hypotheses: unknown[] };
  assert.deepEqual(parsed.hypotheses, []);
});

test("DryModel judge returns decisions for every candidate", async () => {
  const model = new DryModel();
  const candidates = [
    {
      id: "c1",
      claim: "Critical defect",
      severity: "critical" as const,
      confidence: 0.9,
      evidence: ["src/a.ts:1"],
      suggestedExperiment: "run",
      file: "src/a.ts",
      tags: ["bug"],
      agent: "luna-bug",
      agentKind: "bug" as const,
      mergedFrom: ["h1"],
      occurrences: 1,
      score: 9,
    },
    {
      id: "c2",
      claim: "Weak signal",
      severity: "low" as const,
      confidence: 0.2,
      evidence: ["src/b.ts:1"],
      suggestedExperiment: "run",
      file: "src/b.ts",
      tags: ["bug"],
      agent: "luna-bug",
      agentKind: "bug" as const,
      mergedFrom: ["h2"],
      occurrences: 1,
      score: 1,
    },
  ];
  const response = await model.complete(
    task({ role: "terra", kind: "judge", context: { candidates, maxToProve: 1, minConfidence: 0.5, minSeverity: "medium" } }),
  );
  const parsed = extractJson(response.text) as { decisions: Array<{ hypothesisId: string; verdict: string }> };
  assert.equal(parsed.decisions.length, 2);
  assert.equal(parsed.decisions.find((decision) => decision.hypothesisId === "c1")?.verdict, "PROVE");
  assert.equal(parsed.decisions.find((decision) => decision.hypothesisId === "c2")?.verdict, "DISCARD");
});

test("DryModel final review marks verified findings as approved", async () => {
  const model = new DryModel();
  const response = await model.complete(
    task({
      role: "astra",
      kind: "final_review",
      context: {
        items: [
          {
            candidateId: "c1",
            severity: "high",
            proofStatus: "confirmed",
            repairExit: "VERIFIED",
            verificationPassed: true,
            repairAttempts: 1,
          },
        ],
      },
    }),
  );
  const parsed = extractJson(response.text) as { reviews: Array<{ approval: string; fixCorrectness: string }> };
  assert.equal(parsed.reviews[0].approval, "approve");
  assert.equal(parsed.reviews[0].fixCorrectness, "correct");
});

test("DryModel respects the onCall hook", async () => {
  const calls: string[] = [];
  const model = createDryModel({ onCall: (modelTask) => calls.push(modelTask.kind) });
  await model.complete(task({ context: { agentKind: "bug", files: [] } }));
  assert.deepEqual(calls, ["swarm_agent"]);
});

test("DryModel repair patch behavior unsafe emits a restricted-path patch", async () => {
  const model = new DryModel({ repairBehavior: "unsafe" });
  const response = await model.complete(
    task({
      role: "terra",
      kind: "repair_patch",
      context: {
        candidate: { id: "c1", tags: ["rule:sql-injection"], file: "src/a.ts" },
        attempt: 1,
        strategy: "fix",
        fileContents: { "src/a.ts": "const a = 1;" },
      },
    }),
  );
  const parsed = extractJson(response.text) as { patch: string };
  assert.match(parsed.patch, /\.github\/workflows\/ci\.yml/);
});

test("DryModel repair patch returns an empty patch without a rule", async () => {
  const model = new DryModel({ repairBehavior: "always-fail" });
  const response = await model.complete(
    task({
      role: "terra",
      kind: "repair_patch",
      context: {
        candidate: { id: "c1", tags: [], file: "src/a.ts" },
        attempt: 1,
        strategy: "fix",
        fileContents: { "src/a.ts": "const a = 1;" },
      },
    }),
  );
  const parsed = extractJson(response.text) as { patch: string };
  assert.ok(parsed.patch.length > 0);
});

test("ModelRouter reports dry mode and tracks usage", async () => {
  const router = new ModelRouter({ config: baseConfig.models, mode: "dry" });
  assert.equal(router.dryRun, true);
  await router.complete(task({ context: { agentKind: "bug", files: [] } }));
  await router.complete(task({ role: "terra", kind: "judge", context: { candidates: [] } }));
  const usage = router.usage();
  assert.equal(usage.calls, 2);
  assert.equal(usage.callsByRole.luna, 1);
  assert.equal(usage.callsByRole.terra, 1);
  assert.ok(usage.tokensIn > 0);
  assert.ok(usage.credits > 0);
});

test("ModelRouter enforces the model call limit", async () => {
  const router = new ModelRouter({ config: baseConfig.models, mode: "dry", maxCalls: 1 });
  await router.complete(task({ context: { agentKind: "bug", files: [] } }));
  await assert.rejects(
    () => router.complete(task({ context: { agentKind: "bug", files: [] } })),
    ModelCallLimitError,
  );
});

test("ModelRouter accepts custom clients", async () => {
  const custom: ModelClient = {
    id: "custom",
    dryRun: false,
    complete: async (modelTask) => ({
      text: `custom:${modelTask.kind}`,
      model: "custom",
      tokensIn: 2,
      tokensOut: 3,
      durationMs: 1,
    }),
  };
  const router = new ModelRouter({ config: baseConfig.models, mode: "dry", luna: custom, terra: custom, astra: custom });
  assert.equal(router.dryRun, false);
  const response = await router.complete(task({}));
  assert.equal(response.text, "custom:swarm_agent");
});

test("live mode refuses to start without an API key", () => {
  assert.throws(
    () => new ModelRouter({ config: { ...baseConfig.models, apiKey: undefined }, mode: "live" }),
    /requires CORTADO_AI_API_KEY/,
  );
});

test("OpenAiCompatibleClient parses a successful response", async () => {
  const requests: Array<{ url: string; body: unknown }> = [];
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "{}")) });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
  const client = new OpenAiCompatibleClient({
    role: "terra",
    model: "terra-test",
    config: { ...baseConfig.models, apiKey: "test-key", baseUrl: "https://example.test/v1" },
    fetchImpl: fakeFetch,
  });
  const response = await client.complete(task({ role: "terra", kind: "judge" }));
  assert.equal(response.text, '{"ok":true}');
  assert.equal(response.tokensIn, 11);
  assert.equal(response.tokensOut, 7);
  assert.equal(requests[0].url, "https://example.test/v1/chat/completions");
  const body = requests[0].body as { response_format?: unknown; model: string };
  assert.equal(body.model, "terra-test");
  assert.ok(body.response_format);
});

test("OpenAiCompatibleClient retries transient failures", async () => {
  let attempts = 0;
  const fakeFetch = (async () => {
    attempts++;
    if (attempts === 1) return new Response("upstream", { status: 503 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "recovered" } }] }), { status: 200 });
  }) as typeof fetch;
  const client = new OpenAiCompatibleClient({
    role: "luna",
    model: "luna-test",
    config: { ...baseConfig.models, apiKey: "test-key", maxRetries: 1 },
    fetchImpl: fakeFetch,
  });
  const response = await client.complete(task({}));
  assert.equal(response.text, "recovered");
  assert.equal(attempts, 2);
});

test("OpenAiCompatibleClient surfaces upstream errors", async () => {
  const fakeFetch = (async () =>
    new Response(JSON.stringify({ error: { message: "bad request" } }), { status: 400 })) as typeof fetch;
  const client = new OpenAiCompatibleClient({
    role: "luna",
    model: "luna-test",
    config: { ...baseConfig.models, apiKey: "test-key", maxRetries: 0 },
    fetchImpl: fakeFetch,
  });
  await assert.rejects(() => client.complete(task({})), /bad request/);
});
