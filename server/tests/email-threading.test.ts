import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMessageId, normalizeReferencesForStorage, parseReferenceIds, resolveInboundThreading } from "../email-threading";

test("normalizes and formats reference chain for canonical storage", () => {
  assert.equal(normalizeMessageId(" <abc@x> "), "abc@x");
  assert.equal(normalizeReferencesForStorage(" <a@x>   <b@x> c@x "), "a@x b@x c@x");
  assert.deepEqual(parseReferenceIds("<a@x> b@x"), ["a@x", "b@x"]);
});

test("compose -> external reply -> cortardo reply -> external reply stays on one thread", () => {
  const composeMessageId = normalizeMessageId("compose-1@app")!;
  const externalReplyInReplyTo = normalizeMessageId(`<${composeMessageId}>`)!;
  const cortardoReplyMessageId = normalizeMessageId("agent-1@app")!;
  const cortardoRefs = normalizeReferencesForStorage(`${composeMessageId} ${externalReplyInReplyTo}`)!;
  const externalReply2InReplyTo = normalizeMessageId(`<${cortardoReplyMessageId}>`)!;
  const externalReply2Refs = parseReferenceIds(`<${cortardoRefs.replace(/ /g, '> <')}> <${cortardoReplyMessageId}>`);

  const knownThreads = new Map<string, string>([
    [composeMessageId, composeMessageId],
    [externalReplyInReplyTo, composeMessageId],
    [cortardoReplyMessageId, composeMessageId],
  ]);

  const candidates = [externalReply2InReplyTo, ...externalReply2Refs].filter(Boolean) as string[];
  const resolved = candidates.map((c) => knownThreads.get(c)).find(Boolean);
  assert.equal(resolved, composeMessageId);
});

test("missing references uses self seed when no local parent exists", async () => {
  const result = await resolveInboundThreading(
    "new-1@app",
    undefined,
    undefined,
    async () => undefined,
  );
  assert.equal(result.threadId, "new-1@app");
  assert.equal(result.threadSource, "self_seed");
});

test("broken in-reply-to falls back to newest matching reference", async () => {
  const result = await resolveInboundThreading(
    "new-2@app",
    "missing@app",
    "<old@app> <match@app>",
    async (id) => (id === "match@app" ? { threadId: "thread-A" } : undefined),
  );
  assert.equal(result.threadId, "thread-A");
  assert.equal(result.threadSource, "parent_match");
  assert.equal(result.parentMessageId, "match@app");
});

test("unrelated inbound emails do not cross-link without local parents", async () => {
  const a = await resolveInboundThreading("arrival-a@app", undefined, "<random@ext>", async () => undefined);
  const b = await resolveInboundThreading("arrival-b@app", undefined, "<random@ext>", async () => undefined);
  assert.equal(a.threadId, "arrival-a@app");
  assert.equal(b.threadId, "arrival-b@app");
  assert.notEqual(a.threadId, b.threadId);
});

test("outbound reply thread id remains stable for follow-up inbound", async () => {
  const parentThreadId = normalizeMessageId("parent-no-thread@app")!;
  const outboundReplyId = normalizeMessageId("reply-1@app")!;
  const known = new Map<string, { threadId?: string }>([
    [parentThreadId, { threadId: parentThreadId }],
    [outboundReplyId, { threadId: parentThreadId }],
  ]);
  const inbound = await resolveInboundThreading(
    "customer-followup@app",
    outboundReplyId,
    `<${parentThreadId}> <${outboundReplyId}>`,
    async (id) => known.get(id),
  );
  assert.equal(inbound.threadId, parentThreadId);
  assert.equal(inbound.threadSource, "in_reply_to");
});
