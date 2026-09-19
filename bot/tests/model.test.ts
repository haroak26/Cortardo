import assert from "node:assert/strict";
import test from "node:test";
import {
  HttpCodeBotModelClient,
  codegenModelConfig,
  resolveCodeBotModelConfig,
  type CodeBotModelConfig,
} from "../src/model.ts";

const CONFIG: CodeBotModelConfig = {
  model: "z-ai/glm-5.3",
  swarmModel: "openai/gpt-5-nano",
  codegenModel: "openai/gpt-5.6-sol",
  baseUrl: "http://gateway.test",
  apiKey: "test-key",
  timeoutMs: 1_000,
  maxRetries: 0,
  maxTokens: 100,
  reasoning: "medium",
  codegenReasoning: "minimal",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status });
}

test("concurrent capability rejections each recover on their own request", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if ("temperature" in body) {
      return jsonResponse(400, {
        error: {
          message: "Unsupported value: 'temperature' does not support 0.2 with this model. Only the default (1) value is supported.",
          param: "temperature",
        },
      });
    }
    return jsonResponse(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 4 } },
    });
  }) as typeof fetch;

  const client = new HttpCodeBotModelClient(CONFIG, fetchImpl);
  const [first, second] = await Promise.all([
    client.complete({ system: "s", user: "first" }),
    client.complete({ system: "s", user: "second" }),
  ]);

  assert.equal(first.text, '{"ok":true}');
  assert.equal(second.text, '{"ok":true}');
  assert.equal(requests.length, 4, "both requests retried without temperature");
  assert.equal(requests.filter((request) => "temperature" in request).length, 2);
  assert.equal(first.cachedTokensIn, 4, "cached prompt tokens are reported");
});

test("a capability fallback still works when another call already disabled the field", async () => {
  let temperatureRejections = 0;
  const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    if ("temperature" in body) {
      temperatureRejections += 1;
      return jsonResponse(400, { error: { message: "Unsupported value: 'temperature' does not support 0.2 with this model." } });
    }
    return jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  }) as typeof fetch;

  const client = new HttpCodeBotModelClient(CONFIG, fetchImpl);
  await client.complete({ system: "s", user: "warm" });
  const afterFlag = await client.complete({ system: "s", user: "clean" });
  assert.equal(afterFlag.text, '{"ok":true}');
  assert.equal(temperatureRejections, 1, "the second call never sends temperature again");
});

test("max_tokens rejections walk down to omitting the cap", async () => {
  const params: Array<string | undefined> = [];
  const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    const sent = body.max_tokens !== undefined ? "max_tokens" : body.max_completion_tokens !== undefined ? "max_completion_tokens" : undefined;
    params.push(sent);
    if (sent !== undefined) {
      return jsonResponse(400, { error: { message: "Unsupported parameter: 'max_tokens' is not supported with this model." } });
    }
    return jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  }) as typeof fetch;

  const client = new HttpCodeBotModelClient(CONFIG, fetchImpl);
  const completion = await client.complete({ system: "s", user: "u" });
  assert.equal(completion.text, '{"ok":true}');
  assert.deepEqual(params, ["max_tokens", "max_completion_tokens", undefined]);
});

test("codegen model config uses minimal reasoning and the GPT 5.6 Sol default", () => {
  const config = resolveCodeBotModelConfig({});
  assert.equal(config.codegenModel, "openai/gpt-5.6-sol");
  assert.equal(config.codegenReasoning, "minimal");
  const codegen = codegenModelConfig(config);
  assert.equal(codegen.model, "openai/gpt-5.6-sol");
  assert.equal(codegen.reasoning, "minimal");
  assert.equal(codegen.maxTokens, config.codegenMaxTokens, "codegen gets its own output ceiling");

  const overridden = resolveCodeBotModelConfig({ CODEBOT_REASONING_CODEGEN: "high" });
  assert.equal(overridden.codegenReasoning, "high");
  assert.equal(codegenModelConfig(overridden).reasoning, "high");
});

test("cached prompt tokens are billed at the cached rate", async () => {
  const fetchImpl = (async () =>
    jsonResponse(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1_000_000 } },
    })) as typeof fetch;
  const client = new HttpCodeBotModelClient({ ...CONFIG, model: "openai/gpt-5-nano" }, fetchImpl);
  const completion = await client.complete({ system: "s", user: "u" });
  assert.equal(completion.cachedTokensIn, 1_000_000);
  assert.equal(completion.costUsd, 0.005, "cached gpt-5-nano input bills at 10% of the input rate");
});

test("unknown models are priced conservatively instead of free", async () => {
  const fetchImpl = (async () =>
    jsonResponse(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 1_000_000, completion_tokens: 0 },
    })) as typeof fetch;
  const client = new HttpCodeBotModelClient({ ...CONFIG, model: "openai/custom-mystery" }, fetchImpl);
  const completion = await client.complete({ system: "s", user: "u" });
  assert.equal(completion.costUsd, 2, "an uncatalogued model bills at the priciest known input rate");
});

test("requests ask OpenRouter to include usage.cost", async () => {
  let body: Record<string, unknown> | undefined;
  const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return jsonResponse(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1, cost: 0.0001 },
    });
  }) as typeof fetch;

  const client = new HttpCodeBotModelClient(CONFIG, fetchImpl);
  const completion = await client.complete({ system: "s", user: "u" });
  assert.deepEqual(body?.usage, { include: true });
  assert.equal(completion.costUsd, 0.0001, "the reported OpenRouter cost wins over the catalog estimate");
});

test("OpenRouter in-flight credit rejections are retried, not fatal", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls += 1;
    if (calls === 1) {
      return jsonResponse(402, {
        error: {
          message:
            "This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.",
          code: 402,
        },
      });
    }
    return jsonResponse(200, {
      choices: [{ message: { content: '{"ok":true}' } }],
      usage: { prompt_tokens: 2, completion_tokens: 1 },
    });
  }) as typeof fetch;

  const client = new HttpCodeBotModelClient({ ...CONFIG, maxRetries: 1 }, fetchImpl);
  const completion = await client.complete({ system: "s", user: "u" });
  assert.equal(completion.text, '{"ok":true}');
  assert.equal(calls, 2, "the in-flight 402 was retried once");
});

test("prompt_cache_key is sent and disabled per request when the gateway rejects it", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    if ("prompt_cache_key" in body) {
      return jsonResponse(400, { error: { message: "Unsupported parameter: 'prompt_cache_key' is not supported with this model." } });
    }
    return jsonResponse(200, { choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 2, completion_tokens: 1 } });
  }) as typeof fetch;

  const client = new HttpCodeBotModelClient(CONFIG, fetchImpl);
  const completion = await client.complete({ system: "s", user: "u", cacheKey: "codebot:swarm:acme/app:7:abcdef" });
  assert.equal(completion.text, '{"ok":true}');
  assert.equal(bodies.length, 2, "the rejected request retried without the cache key");
  assert.equal(bodies[0].prompt_cache_key, "codebot:swarm:acme/app:7:abcdef");
  assert.ok(!("prompt_cache_key" in bodies[1]));
});
