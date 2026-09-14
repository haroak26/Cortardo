import assert from "node:assert/strict";
import { OpenAiCompatibleClient } from "../../../src/models/live";
import { ModelRouter, createModelRouter } from "../../../src/models/router";
import { ModelCallLimitError, type ModelClient, type ModelTask } from "../../../src/models/types";
import { resolveConfig } from "../../../src/config";
import { defineCases } from "../../exhaustive/types";

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
  };
}

function clientWith(
  fetchImpl: typeof fetch,
  overrides: Partial<{ maxRetries: number; apiKey: string | undefined; baseUrl: string }> = {},
) {
  return new OpenAiCompatibleClient({
    role: "luna",
    model: "luna-test",
    config: {
      ...config.models,
      apiKey: overrides.apiKey === undefined ? "test-key" : overrides.apiKey,
      baseUrl: overrides.baseUrl ?? "https://api.example.test/v1",
      maxRetries: overrides.maxRetries ?? 0,
    },
    fetchImpl,
  });
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

const OK_PAYLOAD = {
  choices: [{ message: { content: "hello" } }],
  usage: { prompt_tokens: 10, completion_tokens: 4 },
};

export function buildTransportGroup() {
  const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
    {
      name: "transport parses a successful response",
      run: async () => {
        const client = clientWith((async () => jsonResponse(OK_PAYLOAD)) as typeof fetch);
        const response = await client.complete(task());
        assert.equal(response.text, "hello");
        assert.equal(response.tokensIn, 10);
        assert.equal(response.tokensOut, 4);
      },
    },
    {
      name: "transport sends system and user messages",
      run: async () => {
        let body: { messages?: Array<{ role: string; content: string }> } = {};
        const client = clientWith((async (_url: string, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch);
        await client.complete(task({ system: "SYS", user: "USR" }));
        assert.deepEqual(body.messages, [
          { role: "system", content: "SYS" },
          { role: "user", content: "USR" },
        ]);
      },
    },
    {
      name: "transport uses low temperature for luna",
      run: async () => {
        let body: { temperature?: number } = {};
        const client = clientWith((async (_url: string, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch);
        await client.complete(task({ role: "luna" }));
        assert.equal(body.temperature, 0.1);
      },
    },
    {
      name: "transport uses higher temperature for terra",
      run: async () => {
        let body: { temperature?: number } = {};
        const client = clientWith((async (_url: string, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch);
        await client.complete(task({ role: "terra", kind: "judge" }));
        assert.equal(body.temperature, 0.2);
      },
    },
    {
      name: "transport caps luna output tokens",
      run: async () => {
        let body: { max_tokens?: number } = {};
        const client = clientWith((async (_url: string, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch);
        await client.complete(task({ role: "luna" }));
        assert.equal(body.max_tokens, config.models.maxTokensLuna);
      },
    },
    {
      name: "transport requests JSON response format when expected",
      run: async () => {
        let body: { response_format?: unknown } = {};
        const client = clientWith((async (_url: string, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch);
        await client.complete(task({ expectJson: true }));
        assert.ok(body.response_format);
      },
    },
    {
      name: "transport omits response format for free text",
      run: async () => {
        let body: { response_format?: unknown } = {};
        const client = clientWith((async (_url: string, init?: RequestInit) => {
          body = JSON.parse(String(init?.body));
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch);
        await client.complete(task({ expectJson: false }));
        assert.equal(body.response_format, undefined);
      },
    },
    {
      name: "transport estimates tokens when usage is missing",
      run: async () => {
        const client = clientWith((async () => jsonResponse({ choices: [{ message: { content: "hello" } }] })) as typeof fetch);
        const response = await client.complete(task());
        assert.ok(response.tokensIn > 0);
        assert.ok(response.tokensOut > 0);
      },
    },
    {
      name: "transport tolerates empty choices",
      run: async () => {
        const client = clientWith((async () => jsonResponse({ choices: [] })) as typeof fetch);
        const response = await client.complete(task());
        assert.equal(response.text, "");
      },
    },
    {
      name: "transport rejects malformed response bodies",
      run: async () => {
        const client = clientWith((async () => new Response("not json", { status: 200 })) as typeof fetch);
        await assert.rejects(() => client.complete(task()));
      },
    },
    {
      name: "transport surfaces 401 without retrying",
      run: async () => {
        let attempts = 0;
        const client = clientWith((async () => {
          attempts++;
          return jsonResponse({ error: { message: "unauthorized" } }, 401);
        }) as typeof fetch, { maxRetries: 1 });
        await assert.rejects(() => client.complete(task()), /unauthorized/);
        assert.equal(attempts, 1);
      },
    },
    {
      name: "transport surfaces 404 without retrying",
      run: async () => {
        let attempts = 0;
        const client = clientWith((async () => {
          attempts++;
          return new Response("missing", { status: 404 });
        }) as typeof fetch, { maxRetries: 1 });
        await assert.rejects(() => client.complete(task()));
        assert.equal(attempts, 1);
      },
    },
    {
      name: "transport retries 429 then succeeds",
      run: async () => {
        let attempts = 0;
        const client = clientWith((async () => {
          attempts++;
          return attempts === 1 ? new Response("busy", { status: 429 }) : jsonResponse(OK_PAYLOAD);
        }) as typeof fetch, { maxRetries: 1 });
        const response = await client.complete(task());
        assert.equal(response.text, "hello");
        assert.equal(attempts, 2);
      },
    },
    {
      name: "transport retries 503 then succeeds",
      run: async () => {
        let attempts = 0;
        const client = clientWith((async () => {
          attempts++;
          return attempts === 1 ? new Response("down", { status: 503 }) : jsonResponse(OK_PAYLOAD);
        }) as typeof fetch, { maxRetries: 1 });
        const response = await client.complete(task());
        assert.equal(attempts, 2);
        assert.equal(response.text, "hello");
      },
    },
    {
      name: "transport retries network errors",
      run: async () => {
        let attempts = 0;
        const client = clientWith((async () => {
          attempts++;
          if (attempts === 1) throw new Error("socket hangup");
          return jsonResponse(OK_PAYLOAD);
        }) as typeof fetch, { maxRetries: 1 });
        const response = await client.complete(task());
        assert.equal(attempts, 2);
        assert.equal(response.text, "hello");
      },
    },
    {
      name: "transport gives up after exhausting retries",
      run: async () => {
        let attempts = 0;
        const client = clientWith((async () => {
          attempts++;
          throw new Error("offline");
        }) as typeof fetch, { maxRetries: 1 });
        await assert.rejects(() => client.complete(task()), /offline/);
        assert.equal(attempts, 2);
      },
    },
    {
      name: "transport aborts hung requests",
      run: async () => {
        const client = clientWith(((url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          })) as unknown as typeof fetch, { maxRetries: 0 });
        await assert.rejects(() => client.complete(task({ timeoutMs: 15 })), /aborted/);
      },
    },
    {
      name: "transport prefers upstream usage over estimates",
      run: async () => {
        const client = clientWith((async () =>
          jsonResponse({ choices: [{ message: { content: "x" } }], usage: { prompt_tokens: 123, completion_tokens: 45 } })) as typeof fetch);
        const response = await client.complete(task());
        assert.equal(response.tokensIn, 123);
        assert.equal(response.tokensOut, 45);
      },
    },
    {
      name: "transport normalizes the base url",
      run: async () => {
        let url = "";
        const client = clientWith((async (input: string) => {
          url = String(input);
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch, { baseUrl: "https://api.example.test/v1/" });
        await client.complete(task());
        assert.equal(url, "https://api.example.test/v1/chat/completions");
      },
    },
    {
      name: "transport sends the bearer token",
      run: async () => {
        let authorization = "";
        const client = clientWith((async (_url: string, init?: RequestInit) => {
          authorization = (init?.headers as Record<string, string>)?.authorization ?? "";
          return jsonResponse(OK_PAYLOAD);
        }) as unknown as typeof fetch);
        await client.complete(task());
        assert.equal(authorization, "Bearer test-key");
      },
    },
    {
      name: "router dispatches tasks by role",
      run: async () => {
        const seen: string[] = [];
        const makeClient = (id: string): ModelClient => ({
          id,
          dryRun: true,
          complete: async () => {
            seen.push(id);
            return { text: "{}", model: id, tokensIn: 1, tokensOut: 1, durationMs: 1 };
          },
        });
        const router = new ModelRouter({
          config: config.models,
          mode: "dry",
          luna: makeClient("luna"),
          terra: makeClient("terra"),
          astra: makeClient("astra"),
        });
        await router.complete(task({ role: "luna" }));
        await router.complete(task({ role: "terra", kind: "judge" }));
        await router.complete(task({ role: "astra", kind: "final_review" }));
        assert.deepEqual(seen, ["luna", "terra", "astra"]);
      },
    },
    {
      name: "router records usage per role",
      run: async () => {
        const router = new ModelRouter({ config: config.models, mode: "dry" });
        await router.complete(task({ role: "luna", context: { agentKind: "bug", files: [] } }));
        await router.complete(task({ role: "terra", kind: "judge", context: { candidates: [] } }));
        await router.complete(task({ role: "astra", kind: "final_review", context: { items: [] } }));
        const usage = router.usage();
        assert.equal(usage.calls, 3);
        assert.equal(usage.callsByRole.luna, 1);
        assert.equal(usage.callsByRole.terra, 1);
        assert.equal(usage.callsByRole.astra, 1);
      },
    },
    {
      name: "router allows exactly the configured number of calls",
      run: async () => {
        const router = new ModelRouter({ config: config.models, mode: "dry", maxCalls: 2 });
        await router.complete(task({ context: { agentKind: "bug", files: [] } }));
        await router.complete(task({ context: { agentKind: "bug", files: [] } }));
        await assert.rejects(() => router.complete(task({})), ModelCallLimitError);
      },
    },
    {
      name: "router reports live-ness for custom clients",
      run: () => {
        const live: ModelClient = {
          id: "live",
          dryRun: false,
          complete: async () => ({ text: "", model: "live", tokensIn: 0, tokensOut: 0, durationMs: 1 }),
        };
        const router = new ModelRouter({ config: config.models, mode: "dry", luna: live, terra: live, astra: live });
        assert.equal(router.dryRun, false);
      },
    },
    {
      name: "createModelRouter builds a dry router by default",
      run: () => {
        const router = createModelRouter({ config: config.models, mode: "dry" });
        assert.equal(router.dryRun, true);
        assert.equal(router.usage().calls, 0);
      },
    },
  ];
  return defineCases("transport", cases);
}
