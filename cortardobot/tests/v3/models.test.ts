import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveV3Config } from "../../src/v3/config.ts";
import { HttpModelClient, ModelRouter, ModelError, preflightModels } from "../../src/v3/models.ts";
import { DEFAULT_MODELS } from "../../../shared/models.ts";
import type { ModelTask } from "../../src/v3/types.ts";

function task(overrides: Partial<ModelTask> = {}): ModelTask {
  return { role: "terra", kind: "repair_agent", system: "s", user: "u", expectJson: true, label: "test", ...overrides };
}

test("3.1 defaults to the selected GPT models", () => {
  const previous = { ...process.env };
  for (const key of ["CORTADO_MODEL_LUNA", "CORTADO_MODEL_TERRA", "CORTADO_MODEL_ASTRA", "CORTARDO_MODEL_LUNA"]) delete process.env[key];
  const config = resolveV3Config();
  assert.equal(config.models.luna, DEFAULT_MODELS.luna);
  assert.equal(config.models.terra, DEFAULT_MODELS.terra);
  assert.equal(config.models.astra, DEFAULT_MODELS.astra);
  assert.equal(config.models.reasoning.terra, "high");
  process.env = previous;
});

test("model env overrides win and legacy CORTARDO_* keys are honoured", () => {
  const previous = { ...process.env };
  process.env.CORTADO_MODEL_TERRA = "openai/gpt-5.6-sol";
  process.env.CORTARDO_MODEL_ASTRA = "openai/gpt-5.6-luna";
  const config = resolveV3Config();
  assert.equal(config.models.terra, "openai/gpt-5.6-sol");
  assert.equal(config.models.astra, "openai/gpt-5.6-luna");
  process.env = previous;
});

test("preflight fails when a configured model is not served", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: [{ id: "openai/gpt-5.6-luna" }, { id: "openai/gpt-5.6-terra" }] }), { status: 200 })) as unknown as typeof fetch;
  const config = resolveV3Config({ models: { astra: "openai/gpt-6-astra" } });
  await assert.rejects(() => preflightModels(config.models, fetchImpl), /not available/);
});

test("preflight accepts vendor-prefixed ids when the gateway lists the bare model", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: [{ id: "gpt-5.6-luna" }, { id: "gpt-5.6-terra" }, { id: "gpt-6-astra" }] }), { status: 200 })) as unknown as typeof fetch;
  const config = resolveV3Config();
  const result = await preflightModels(config.models, fetchImpl);
  assert.equal(result.checked, true);
  assert.deepEqual(result.missing, []);
});

test("preflight accepts a bare configured id listed with a vendor prefix", async () => {
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: [{ id: "openai/gpt-5.6-luna" }, { id: "openai/gpt-5.6-terra" }, { id: "openai/gpt-6-astra" }] }), { status: 200 })) as unknown as typeof fetch;
  const config = resolveV3Config({ models: { luna: "gpt-5.6-luna", terra: "gpt-5.6-terra", astra: "gpt-6-astra" } });
  const result = await preflightModels(config.models, fetchImpl);
  assert.equal(result.checked, true);
  assert.deepEqual(result.missing, []);
});

test("preflight warns instead of failing when the gateway has no /models", async () => {
  const fetchImpl = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
  const config = resolveV3Config();
  const result = await preflightModels(config.models, fetchImpl);
  assert.equal(result.checked, false);
  assert.match(result.warning ?? "", /404/);
});

test("preflight fails hard when the gateway rejects the key", async () => {
  const fetchImpl = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
  const config = resolveV3Config();
  await assert.rejects(() => preflightModels(config.models, fetchImpl), /rejected the gateway key/);
});

test("HttpModelClient retries without reasoning_effort when the gateway rejects it", async () => {
  const calls: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push(body);
    if ("reasoning_effort" in body) return new Response("unknown field reasoning_effort", { status: 400 });
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
  }) as unknown as typeof fetch;
  const config = resolveV3Config();
  const client = new HttpModelClient({ role: "terra", model: config.models.terra, config: config.models, fetchImpl });
  const response = await client.complete(task());
  assert.equal(response.text, "{}");
  assert.equal(calls.length, 2);
  assert.ok("reasoning_effort" in calls[0]);
  assert.ok(!("reasoning_effort" in calls[1]));
});

test("HttpModelClient falls back to non-JSON mode and reports cached tokens + catalog cost", async () => {
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    if (body.response_format) return new Response("response_format not supported", { status: 400 });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 400_000 } } }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  const config = resolveV3Config();
  const client = new HttpModelClient({ role: "terra", model: "openai/gpt-5.6-terra", config: config.models, fetchImpl });
  const response = await client.complete(task());
  assert.equal(response.cachedTokensIn, 400_000);
  assert.equal(response.costUsd, 3);
});

test("ModelRouter records ids and enforces the call budget", async () => {
  const config = resolveV3Config().models;
  const failing = { id: "failing", complete: async () => { throw new ModelError("nope", false); } };
  const router = new ModelRouter({ clients: { luna: failing, terra: failing, astra: failing }, config, maxCalls: 1 });
  assert.equal(router.idFor("terra"), "failing");
  await assert.rejects(() => router.complete(task({ role: "terra" })), /nope/);
  await assert.rejects(() => router.complete(task({ role: "terra" })), /budget exhausted/);
});
