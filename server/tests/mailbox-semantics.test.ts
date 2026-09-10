import assert from "node:assert/strict";
import test from "node:test";

type Mailbox = "inbox" | "sent" | "draft" | "trash";

type FixtureMessage = {
  id: number;
  threadId: string;
  mailbox: Mailbox;
  fromAddress: string;
  toAddress: string;
  subject: string;
};

const fixtureMessages: FixtureMessage[] = [
  {
    id: 1,
    threadId: "thread-1",
    mailbox: "inbox",
    fromAddress: "customer@example.com",
    toAddress: "support@cortardo.test",
    subject: "Need help",
  },
  {
    id: 2,
    threadId: "thread-1",
    mailbox: "sent",
    fromAddress: "support@cortardo.test",
    toAddress: "customer@example.com",
    subject: "Re: Need help",
  },
  {
    id: 3,
    threadId: "thread-2",
    mailbox: "sent",
    fromAddress: "support@cortardo.test",
    toAddress: "prospect@example.com",
    subject: "Intro",
  },
];

function listByMailbox(messages: FixtureMessage[], mailbox: Mailbox) {
  return messages.filter((m) => m.mailbox === mailbox);
}

function getThread(messages: FixtureMessage[], threadId: string) {
  return messages.filter((m) => m.threadId === threadId);
}

test("outbound messages appear in sent mailbox, not inbox", () => {
  const inbox = listByMailbox(fixtureMessages, "inbox");
  const sent = listByMailbox(fixtureMessages, "sent");

  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].id, 1);

  assert.equal(sent.length, 2);
  assert.deepEqual(sent.map((m) => m.id).sort((a, b) => a - b), [2, 3]);
});

test("thread detail includes both inbound and outbound messages", () => {
  const thread = getThread(fixtureMessages, "thread-1");
  assert.equal(thread.length, 2);
  assert.deepEqual(thread.map((m) => m.mailbox).sort(), ["inbox", "sent"]);
});
