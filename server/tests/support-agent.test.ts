import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSupportAgentSystemPrompt,
  buildSupportGuardSystemPrompt,
  cleanSupportChatTitle,
  formatSupportObservations,
  parseSupportReply,
  supportChatRequestSchema,
} from "@shared/support";
import { completeSupportAgentChat } from "../routes/support";

test("parseSupportReply reads an action envelope", () => {
  const parsed = parseSupportReply(
    '{"message":"Let me look at the page.","actions":[{"tool":"inspect_page","args":{}}],"done":false}',
  );
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.done, false);
  assert.equal(parsed.message, "Let me look at the page.");
  assert.deepEqual(parsed.actions, [{ tool: "inspect_page", args: {} }]);
});

test("parseSupportReply tolerates code fences and surrounding prose", () => {
  const parsed = parseSupportReply(
    'Here you go:\n```json\n{"message":"Done","actions":[],"done":true}\n```',
  );
  assert.equal(parsed.parsed, true);
  assert.equal(parsed.done, true);
  assert.equal(parsed.message, "Done");
  assert.deepEqual(parsed.actions, []);
});

test("parseSupportReply treats plain text as a final answer", () => {
  const parsed = parseSupportReply("This page shows your bot rules.");
  assert.equal(parsed.parsed, false);
  assert.equal(parsed.done, true);
  assert.equal(parsed.message, "This page shows your bot rules.");
  assert.deepEqual(parsed.actions, []);
});

test("parseSupportReply defaults args and drops actions without a tool", () => {
  const parsed = parseSupportReply(
    '{"message":"On it","actions":[{"tool":"click"},{"args":{}},{"tool":"navigate","args":{"path":"/bot/home"}}],"done":false}',
  );
  assert.deepEqual(parsed.actions, [
    { tool: "click", args: {} },
    { tool: "navigate", args: { path: "/bot/home" } },
  ]);
});

test("formatSupportObservations reports successes and failures", () => {
  const message = formatSupportObservations([
    { tool: "click", ok: true, summary: 'Clicked "Save"' },
    { tool: "set_field", ok: false, summary: "ref expired", detail: "run inspect_page again" },
  ]);
  assert.match(message, /ok click: Clicked "Save"/);
  assert.match(message, /failed set_field: ref expired/);
  assert.match(message, /inspect_page/);
});

test("gateway falls back to the next key when one is out of credits", async () => {
  const keyNames = [
    "SUPPORT_AGENT_API_KEY",
    "OPENROUTER_API_KEY",
    "CORTADO_AI_API_KEY",
    "CODEBOT_API_KEY",
  ] as const;
  const saved = Object.fromEntries(keyNames.map((name) => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  try {
    for (const name of keyNames) delete process.env[name];
    process.env.SUPPORT_AGENT_API_KEY = "spent-key";
    process.env.OPENROUTER_API_KEY = "good-key";
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      seen.push(headers.get("authorization") ?? "");
      if (headers.get("authorization") === "Bearer spent-key") {
        return new Response(JSON.stringify({ error: { message: "Credit balance depleted" } }), { status: 402 });
      }
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"message":"hi","actions":[],"done":true}' } }] }),
        { status: 200 },
      );
    }) as typeof fetch;

    const text = await completeSupportAgentChat([{ role: "user", content: "hello" }]);
    assert.equal(text, '{"message":"hi","actions":[],"done":true}');
    assert.deepEqual([...new Set(seen)], ["Bearer spent-key", "Bearer good-key"]);
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of keyNames) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  }
});

test("cleanSupportChatTitle strips noise and caps length", () => {
  assert.equal(cleanSupportChatTitle('"Invite Teammate To Workspace".'), "Invite Teammate To Workspace");
  assert.equal(cleanSupportChatTitle("Title: Save Button Click Test"), "Save Button Click Test");
  const long = cleanSupportChatTitle("a".repeat(80));
  assert.ok(long.length <= 48);
  assert.equal(cleanSupportChatTitle("   "), "");
});

test("guard prompt instructs a strict ALLOW/BLOCK decision", () => {
  const prompt = buildSupportGuardSystemPrompt();
  assert.match(prompt, /ALLOW/);
  assert.match(prompt, /BLOCK/);
  assert.match(prompt, /in-app assistant/);
});

test("chat schema accepts an optional gate string", () => {
  const withGate = supportChatRequestSchema.safeParse({
    messages: [{ role: "user", content: "hi" }],
    gate: "hi",
  });
  assert.equal(withGate.success, true);
  const withoutGate = supportChatRequestSchema.safeParse({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(withoutGate.success, true);
});

test("system prompt lists the browser tools and the page context", () => {
  const prompt = buildSupportAgentSystemPrompt({ path: "/bot/rules", title: "Cortardo — Rules" });
  assert.match(prompt, /Current page: \/bot\/rules/);
  assert.match(prompt, /inspect_page/);
  assert.match(prompt, /navigate/);
  assert.match(prompt, /done/);
});
