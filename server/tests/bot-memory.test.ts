import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Server } from "node:http";
import express from "express";
import { eq } from "drizzle-orm";
import { botSettings, workspaceMembers, type User } from "@shared/schema";
import { db } from "../db";
import { registerBotRoutes } from "../routes/bot";
import { matchesAnyGlob, matchesGlob } from "../lib/bot/glob";

test("glob matcher handles path and basename patterns", () => {
  assert.equal(matchesGlob("src/generated/api.ts", "src/generated/**"), true);
  assert.equal(matchesGlob("src/app.ts", "src/generated/**"), false);
  assert.equal(matchesGlob("deep/nested/package-lock.json", "package-lock.json"), true);
  assert.equal(matchesGlob("a/b/c.snap", "**/*.snap"), true);
  assert.equal(matchesGlob("a/b/c.ts", "**/*.snap"), false);
  assert.equal(matchesAnyGlob("dist/app.min.js", ["**/*.min.js", "vendor/**"]), true);
  assert.equal(matchesAnyGlob("src/main.ts", ["**/*.min.js", "vendor/**"]), false);
});

const hasDb = Boolean(process.env.DATABASE_URL);

let server: Server | undefined;
let baseUrl = "";
let user: User | undefined;
let workspaceId = "";
let previousSettings: typeof botSettings.$inferSelect | undefined;
let settingsRowExisted = false;

before(async () => {
  if (!hasDb) return;
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(eq(workspaceMembers.status, "active"))
    .limit(1);
  if (!member?.userId) return;
  const [row] = await db
    .select()
    .from(botSettings)
    .where(eq(botSettings.workspaceId, member.workspaceId))
    .limit(1);
  settingsRowExisted = Boolean(row);
  previousSettings = row;

  user = { id: member.userId } as User;
  workspaceId = member.workspaceId;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).user = user;
    (req as any).isAuthenticated = () => true;
    next();
  });
  registerBotRoutes(app);
  server = app.listen(0);
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  if (!hasDb || !workspaceId) return;
  if (settingsRowExisted && previousSettings) {
    await db
      .update(botSettings)
      .set({
        commitReviews: previousSettings.commitReviews,
        settings: previousSettings.settings,
        updatedAt: new Date(),
      })
      .where(eq(botSettings.workspaceId, workspaceId));
  } else {
    await db.delete(botSettings).where(eq(botSettings.workspaceId, workspaceId));
  }
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

test("bot memory API round-trips rules, learnings, exclusions and settings", { skip: !hasDb }, async () => {
  assert.ok(server, "test server should be running");

  // Rules
  const createdRule = await api("POST", "/api/bot/rules", {
    workspaceId,
    instruction: "Always flag TODO comments left in production code.",
    glob: "src/**",
  });
  assert.equal(createdRule.status, 201);
  assert.equal(createdRule.json.scope, "All repositories");
  const ruleId = createdRule.json.id as string;
  try {
    const listedRules = await api("GET", `/api/bot/rules?workspaceId=${workspaceId}`);
    assert.equal(listedRules.status, 200);
    assert.ok(listedRules.json.some((rule: any) => rule.id === ruleId));

    const patchedRule = await api("PATCH", `/api/bot/rules/${ruleId}`, { enabled: false });
    assert.equal(patchedRule.status, 200);
    assert.equal(patchedRule.json.enabled, false);

    const invalidRule = await api("POST", "/api/bot/rules", { workspaceId, instruction: "x" });
    assert.equal(invalidRule.status, 400);
  } finally {
    const deleted = await api("DELETE", `/api/bot/rules/${ruleId}`);
    assert.equal(deleted.status, 200);
    assert.equal(deleted.json.ok, true);
  }

  // Learnings
  const createdLearning = await api("POST", "/api/bot/learnings", {
    workspaceId,
    text: "Do not flag arithmetic inside currency test fixtures.",
  });
  assert.equal(createdLearning.status, 201);
  assert.equal(createdLearning.json.source, "manual");
  const learningId = createdLearning.json.id as string;
  try {
    const patchedLearning = await api("PATCH", `/api/bot/learnings/${learningId}`, { active: false });
    assert.equal(patchedLearning.status, 200);
    assert.equal(patchedLearning.json.active, false);
  } finally {
    const deleted = await api("DELETE", `/api/bot/learnings/${learningId}`);
    assert.equal(deleted.status, 200);
  }

  // Exclusions
  const createdExclusion = await api("POST", "/api/bot/exclusions", {
    workspaceId,
    pattern: "vendor/**",
    note: "Third-party code",
  });
  assert.equal(createdExclusion.status, 201);
  assert.equal(createdExclusion.json.scope, "All repositories");
  const exclusionId = createdExclusion.json.id as string;
  try {
    const listed = await api("GET", `/api/bot/exclusions?workspaceId=${workspaceId}`);
    assert.equal(listed.status, 200);
    const row = listed.json.find((entry: any) => entry.id === exclusionId);
    assert.ok(row);
    assert.equal(row.scope, "All repositories");

    const patched = await api("PATCH", `/api/bot/exclusions/${exclusionId}`, { enabled: false });
    assert.equal(patched.status, 200);
    assert.equal(patched.json.enabled, false);
  } finally {
    const deleted = await api("DELETE", `/api/bot/exclusions/${exclusionId}`);
    assert.equal(deleted.status, 200);
  }

  // Settings
  const initial = await api("GET", `/api/bot/settings?workspaceId=${workspaceId}`);
  assert.equal(initial.status, 200);
  assert.equal(typeof initial.json.commitReviews.enabled, "boolean");
  assert.equal(typeof initial.json.settings.pullRequests.autoReview, "boolean");

  const patched = await api("PATCH", "/api/bot/settings", {
    workspaceId,
    commitReviews: { enabled: true },
    settings: { instructions: "Prefer the internal logger over console.log.", pullRequests: { reviewDrafts: true } },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.json.commitReviews.enabled, true);
  assert.equal(patched.json.settings.pullRequests.reviewDrafts, true);

  const reread = await api("GET", `/api/bot/settings?workspaceId=${workspaceId}`);
  assert.equal(reread.json.settings.instructions, "Prefer the internal logger over console.log.");
});
