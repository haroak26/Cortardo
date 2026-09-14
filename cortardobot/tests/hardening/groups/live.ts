import assert from "node:assert/strict";
import { OpenAiCompatibleClient } from "../../../src/models/live";
import { ModelRouter } from "../../../src/models/router";
import { UsageTracker } from "../../../src/models/usage";
import { hypothesisListSchema, judgeSchema, repairPlanSchema } from "../../../src/agents/contracts";
import { evaluateStep } from "../../../src/stages/proof";
import { resolveConfig } from "../../../src/config";
import { defineCases } from "../../exhaustive/types";
import type { ModelTask } from "../../../src/models/types";

const config = resolveConfig({ mode: "dry" });

function task(overrides: Partial<ModelTask> = {}): ModelTask {
  return {
    role: overrides.role ?? "luna",
    kind: overrides.kind ?? "swarm_agent",
    system: overrides.system ?? "system",
    user: overrides.user ?? "user",
    expectJson: overrides.expectJson ?? true,
    context: overrides.context ?? {},
    timeoutMs: overrides.timeoutMs,
    maxTokens: overrides.maxTokens,
  };
}

function clientWith(fetchImpl: typeof fetch, overrides: Partial<{ maxRetries: number; jsonMode: boolean }> = {}) {
  return new OpenAiCompatibleClient({
    role: "luna",
    model: "luna-test",
    config: {
      ...config.models,
      apiKey: "test-key",
      baseUrl: "https://gateway.test/v1",
      maxRetries: overrides.maxRetries ?? 0,
      jsonMode: overrides.jsonMode ?? true,
    },
    fetchImpl,
  });
}

function okPayload(content = "{}", cost?: number): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 10, completion_tokens: 4, ...(cost !== undefined ? { cost } : {}) },
    }),
    { status: 200 },
  );
}

export function buildLiveHardeningGroup() {
  return defineCases("live-hardening", [
    {
      name: "json mode falls back automatically when the gateway rejects it",
      run: async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let calls = 0;
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          calls++;
          if (calls === 1) {
            return new Response(
              JSON.stringify({ error: { message: "no vendor supports ['json_schema']", code: "capability_unavailable" } }),
              { status: 400 },
            );
          }
          return okPayload();
        }) as unknown as typeof fetch;
        const client = clientWith(fakeFetch, { maxRetries: 2 });
        await client.complete(task({ expectJson: true }));
        assert.equal(calls, 2);
        assert.ok(bodies[0].response_format, "first attempt should request JSON mode");
        assert.equal(bodies[1].response_format, undefined, "fallback must drop response_format");
      },
    },
    {
      name: "json mode stays disabled after the first rejection",
      run: async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let calls = 0;
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          calls++;
          if (calls === 1) {
            return new Response(JSON.stringify({ error: { message: "json_schema unsupported" } }), { status: 400 });
          }
          return okPayload();
        }) as unknown as typeof fetch;
        const client = clientWith(fakeFetch, { maxRetries: 1 });
        await client.complete(task({ expectJson: true }));
        await client.complete(task({ expectJson: true }));
        assert.equal(calls, 3);
        assert.equal(bodies[2].response_format, undefined);
      },
    },
    {
      name: "json mode can be disabled by configuration",
      run: async () => {
        const bodies: Array<Record<string, unknown>> = [];
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return okPayload();
        }) as unknown as typeof fetch;
        const client = clientWith(fakeFetch, { jsonMode: false });
        await client.complete(task({ expectJson: true }));
        assert.equal(bodies.length, 1);
        assert.equal(bodies[0].response_format, undefined);
      },
    },
    {
      name: "per-role max token budgets are sent",
      run: async () => {
        const bodies: Array<Record<string, unknown>> = [];
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return okPayload();
        }) as unknown as typeof fetch;
        const luna = clientWith(fakeFetch);
        const terra = new OpenAiCompatibleClient({
          role: "terra",
          model: "terra-test",
          config: { ...config.models, apiKey: "k", jsonMode: false },
          fetchImpl: fakeFetch,
        });
        const astra = new OpenAiCompatibleClient({
          role: "astra",
          model: "astra-test",
          config: { ...config.models, apiKey: "k", jsonMode: false },
          fetchImpl: fakeFetch,
        });
        await luna.complete(task({ role: "luna" }));
        await terra.complete(task({ role: "terra", kind: "judge" }));
        await astra.complete(task({ role: "astra", kind: "final_review" }));
        assert.equal(bodies[0].max_tokens, config.models.maxTokensLuna);
        assert.equal(bodies[1].max_tokens, config.models.maxTokensTerra);
        assert.equal(bodies[2].max_tokens, config.models.maxTokensAstra);
      },
    },
    {
      name: "task level token budgets win over role defaults",
      run: async () => {
        const bodies: Array<Record<string, unknown>> = [];
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          return okPayload();
        }) as unknown as typeof fetch;
        const client = clientWith(fakeFetch);
        await client.complete(task({ maxTokens: 77 }));
        assert.equal(bodies[0].max_tokens, 77);
      },
    },
    {
      name: "provider reported cost drives usage accounting",
      run: () => {
        const tracker = new UsageTracker({ models: config.models });
        tracker.record("luna", 100, 50, 5, 0.0025);
        const snapshot = tracker.snapshot();
        assert.equal(snapshot.costUsd, 0.0025);
        assert.equal(snapshot.credits, 2.5);
        assert.equal(snapshot.tokensIn, 100);
      },
    },
    {
      name: "router records gateway cost across calls",
      run: async () => {
        const fakeFetch = (async () => okPayload("{}", 0.000123)) as unknown as typeof fetch;
        const client = clientWith(fakeFetch);
        const router = new ModelRouter({ config: config.models, mode: "dry", luna: client, terra: client, astra: client });
        await router.complete(task({ context: { agentKind: "bug", files: [] } }));
        const usage = router.usage();
        assert.equal(usage.calls, 1);
        assert.equal(usage.costUsd, 0.000123);
        assert.equal(usage.credits, 0.123);
      },
    },
    {
      name: "string confidences are coerced",
      run: () => {
        const parsed = hypothesisListSchema.parse({
          hypotheses: [
            {
              claim: "A loose comparison weakens the authorization check",
              evidence: ["src/app.ts:10"],
              severity: "high",
              confidence: "0.87",
              suggestedExperiment: "run the test",
            },
          ],
        });
        assert.equal(parsed.hypotheses[0].confidence, 0.87);
      },
    },
    {
      name: "percentage confidences are coerced",
      run: () => {
        const parsed = hypothesisListSchema.parse({
          hypotheses: [
            {
              claim: "A loose comparison weakens the authorization check",
              evidence: ["src/app.ts:10"],
              severity: "high",
              confidence: "87",
              suggestedExperiment: "run the test",
            },
          ],
        });
        assert.equal(parsed.hypotheses[0].confidence, 0.87);
      },
    },
    {
      name: "uppercase severities are coerced",
      run: () => {
        const parsed = hypothesisListSchema.parse({
          hypotheses: [
            {
              claim: "A loose comparison weakens the authorization check",
              evidence: ["src/app.ts:10"],
              severity: "CRITICAL",
              confidence: 0.9,
              suggestedExperiment: "run the test",
            },
          ],
        });
        assert.equal(parsed.hypotheses[0].severity, "critical");
      },
    },
    {
      name: "overlong fields are clipped instead of rejected",
      run: () => {
        const parsed = hypothesisListSchema.parse({
          hypotheses: [
            {
              claim: "x".repeat(900),
              evidence: ["src/app.ts:10"],
              severity: "medium",
              confidence: 0.5,
              suggestedExperiment: "y".repeat(900),
            },
          ],
        });
        assert.equal(parsed.hypotheses[0].claim.length, 400);
        assert.equal(parsed.hypotheses[0].suggestedExperiment.length, 300);
      },
    },
    {
      name: "single-string evidence becomes an array",
      run: () => {
        const parsed = hypothesisListSchema.parse({
          hypotheses: [
            {
              claim: "A loose comparison weakens the authorization check",
              evidence: "src/app.ts:10",
              severity: "high",
              confidence: 0.8,
              suggestedExperiment: "run the test",
            },
          ],
        });
        assert.deepEqual(parsed.hypotheses[0].evidence, ["src/app.ts:10"]);
      },
    },
    {
      name: "judge verdicts and priorities are coerced",
      run: () => {
        const parsed = judgeSchema.parse({
          decisions: [
            {
              hypothesisId: "c1",
              verdict: "prove",
              reason: "high signal",
              priority: "2",
            },
          ],
        });
        assert.equal(parsed.decisions[0].verdict, "PROVE");
        assert.equal(parsed.decisions[0].priority, 2);
      },
    },
    {
      name: "empty reasoning completions retry with a bigger budget",
      run: async () => {
        const bodies: Array<Record<string, unknown>> = [];
        let calls = 0;
        const fakeFetch = (async (_url: string, init?: RequestInit) => {
          bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
          calls++;
          if (calls === 1) {
            return new Response(
              JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "length" }], usage: { prompt_tokens: 10, completion_tokens: 500 } }),
              { status: 200 },
            );
          }
          return okPayload("{}");
        }) as unknown as typeof fetch;
        const client = clientWith(fakeFetch, { maxRetries: 1 });
        const response = await client.complete(task());
        assert.equal(response.text, "{}");
        assert.equal(calls, 2);
        assert.ok(
          Number(bodies[1].max_tokens) > Number(bodies[0].max_tokens),
          "retry should raise the token budget",
        );
      },
    },
    {
      name: "empty non-length completions are not retried by the client",
      run: async () => {
        let calls = 0;
        const fakeFetch = (async () => {
          calls++;
          return new Response(
            JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "stop" }] }),
            { status: 200 },
          );
        }) as unknown as typeof fetch;
        const client = clientWith(fakeFetch, { maxRetries: 2 });
        await assert.rejects(() => client.complete(task()), /empty completion/);
        assert.equal(calls, 1);
      },
    },
    {
      name: "empty reproduction commands are treated as absent",
      run: () => {
        const parsed = judgeSchema.parse({
          decisions: [
            { hypothesisId: "c1", verdict: "PROVE", reason: "strong signal", priority: 1, reproductionCommand: "" },
            { hypothesisId: "c2", verdict: "STATIC_ONLY", reason: "weak signal", priority: 2, reproductionCommand: "   " },
          ],
        });
        assert.equal(parsed.decisions[0].reproductionCommand, undefined);
        assert.equal(parsed.decisions[1].reproductionCommand, undefined);
      },
    },
    {
      name: "empty repair strategies are treated as absent",
      run: () => {
        const parsed = repairPlanSchema.parse({ strategy: "", files: [], rationale: "keep it minimal" });
        assert.equal(parsed.strategy, undefined);
      },
    },
    {
      name: "proof treats an unhydrated repo as inconclusive",
      run: () => {
        const step = {
          strategy: "full_environment" as const,
          command: "npm test",
          expectation: "fail" as const,
          description: "full suite",
        };
        const result = {
          command: "npm test",
          exitCode: 254,
          stdout: "",
          stderr: "npm error Could not read package.json: Error: ENOENT",
          durationMs: 5,
          timedOut: false,
        };
        assert.equal(evaluateStep(step, result), "inconclusive");
      },
    },
    {
      name: "proof treats missing scripts as inconclusive",
      run: () => {
        const step = {
          strategy: "existing_test" as const,
          command: "npm test -- src/app.test.ts",
          expectation: "fail" as const,
          description: "targeted test",
        };
        const result = {
          command: "npm test -- src/app.test.ts",
          exitCode: 1,
          stdout: "",
          stderr: "npm error Missing script: \"test\"",
          durationMs: 5,
          timedOut: false,
        };
        assert.equal(evaluateStep(step, result), "inconclusive");
      },
    },
    {
      name: "proof still matches genuine assertion failures",
      run: () => {
        const step = {
          strategy: "existing_test" as const,
          command: "npm test -- src/app.test.ts",
          expectation: "fail" as const,
          description: "targeted test",
        };
        const result = {
          command: "npm test -- src/app.test.ts",
          exitCode: 1,
          stdout: "",
          stderr: "AssertionError: expected null to be defined",
          durationMs: 5,
          timedOut: false,
        };
        assert.equal(evaluateStep(step, result), "match");
      },
    },
  ]);
}
