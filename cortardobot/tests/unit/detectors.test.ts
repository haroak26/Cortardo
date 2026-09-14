import assert from "node:assert/strict";
import test from "node:test";
import {
  DETECTORS,
  detectForFiles,
  detectorById,
  detectorFix,
  detectorPresentInContent,
  type DetectorFinding,
} from "../../src/agents/detectors";
import { contentFile, makeChangedFile } from "../helpers/factories";

const ALL_KINDS = [
  "bug",
  "auth",
  "security",
  "regression",
  "runtime",
  "performance",
  "database",
  "api",
  "ui",
  "config",
] as const;

function detect(ruleId: string, path: string, content: string): DetectorFinding {
  const finding = detectForFiles([contentFile(path, content)], [...ALL_KINDS], 50).find(
    (item) => item.ruleId === ruleId,
  );
  assert.ok(finding, `${ruleId} did not fire for:\n${content}`);
  return finding;
}

function assertFixed(ruleId: string, path: string, content: string): string {
  const finding = detect(ruleId, path, content);
  const fixed = detectorFix(ruleId, content, finding);
  assert.ok(fixed, `${ruleId} has no fix result`);
  assert.notEqual(fixed.content, content, `${ruleId} fix did not change content`);
  assert.equal(
    detectorPresentInContent(ruleId, fixed.content, finding),
    false,
    `${ruleId} still present after fix:\n${fixed.content}`,
  );
  return fixed.content;
}

test("detector registry exposes the expected detectors", () => {
  assert.equal(DETECTORS.length, 11);
  assert.equal(new Set(DETECTORS.map((detector) => detector.id)).size, DETECTORS.length);
  assert.ok(detectorById("sql-injection"));
  assert.equal(detectorById("nope"), undefined);
});

test("auth-weak-comparison detects and fixes loose equality", () => {
  const content = [
    "export function authorize(userId: string, sessionUserId: string) {",
    "  if (sessionUserId == userId) {",
    "    return false;",
    "  }",
    "  return true;",
    "}",
  ].join("\n");
  const fixed = assertFixed("auth-weak-comparison", "server/auth/session.ts", content);
  assert.match(fixed, /===/);
  assert.equal(detectForFiles([contentFile("server/auth/session.ts", "if (a === b) return true;")], [...ALL_KINDS], 10).length, 0);
});

test("auth-missing-check detects unguarded sensitive routes", () => {
  const content = 'router.delete("/api/admin/users/:id", deleteUserHandler);';
  const fixed = assertFixed("auth-missing-check", "server/routes/admin.ts", content);
  assert.match(fixed, /requireAuth/);

  const guarded = 'router.delete("/api/admin/users/:id", requireAuth, deleteUserHandler);';
  assert.equal(detectForFiles([contentFile("server/routes/admin.ts", guarded)], [...ALL_KINDS], 10).length, 0);

  const globalGuard = [
    "router.use(requireAuth);",
    'router.delete("/api/admin/users/:id", deleteUserHandler);',
  ].join("\n");
  assert.equal(detectForFiles([contentFile("server/routes/admin.ts", globalGuard)], [...ALL_KINDS], 10).length, 0);
});

test("sql-injection detects and parameterizes interpolation", () => {
  const content = "return db.query(`SELECT * FROM users WHERE id = ${userId}`);";
  const fixed = assertFixed("sql-injection", "server/users/repo.ts", content);
  assert.match(fixed, /id = \?/);
  assert.match(fixed, /\[userId\]/);
  assert.equal(
    detectForFiles([contentFile("server/users/repo.ts", 'db.query("SELECT * FROM users WHERE id = ?", [userId]);')], [...ALL_KINDS], 10).length,
    0,
  );
});

test("xss-unsafe-html detects and replaces innerHTML", () => {
  const content = "el.innerHTML = comment.body;";
  const fixed = assertFixed("xss-unsafe-html", "client/components/Comment.tsx", content);
  assert.match(fixed, /textContent/);
});

test("hardcoded-secret detects and moves to environment", () => {
  const content = 'const apiKey = "sk-live-abcdef123456";';
  const fixed = assertFixed("hardcoded-secret", "server/config.ts", content);
  assert.match(fixed, /process\.env\.API_KEY/);
  assert.equal(
    detectForFiles([contentFile("server/config.ts", "const apiKey = process.env.API_KEY ?? \"\";")], [...ALL_KINDS], 10).length,
    0,
  );
});

test("off-by-one-loop detects and fixes <= length", () => {
  const content = "for (let i = 0; i <= items.length; i++) { total += items[i].length; }";
  const fixed = assertFixed("off-by-one-loop", "server/lib/pagination.ts", content);
  assert.match(fixed, /i < items\.length/);
});

test("unhandled-async-rejection detects and adds a catch", () => {
  const content = "return fetchProfile(id).then((profile) => profile.name);";
  const fixed = assertFixed("unhandled-async-rejection", "server/api/profile.ts", content);
  assert.match(fixed, /\.catch\(/);
});

test("sequential-await-map detects and wraps with Promise.all", () => {
  const content = 'const rows = ids.map(async (id) => await db.query("SELECT 1", [id]));';
  const fixed = assertFixed("sequential-await-map", "server/analytics/report.ts", content);
  assert.match(fixed, /await Promise\.all\(/);
});

test("api-breaking-signature detects removed parameters", () => {
  const file = makeChangedFile("server/api/sessions.ts", {
    removed: ["export function createSession(userId: string, expiresIn: number) {"],
    added: ["export function createSession(userId: string) {"],
  });
  const findings = detectForFiles([file], [...ALL_KINDS], 50).filter(
    (item) => item.ruleId === "api-breaking-signature",
  );
  assert.equal(findings.length, 1);
  const fixed = detectorFix("api-breaking-signature", "export function createSession(userId: string) {", findings[0]);
  assert.ok(fixed);
  assert.match(fixed.content, /expiresIn\?: number/);
  assert.equal(detectorPresentInContent("api-breaking-signature", fixed.content, findings[0]), false);
});

test("removed-test-coverage detects removed assertions", () => {
  const file = makeChangedFile("src/a.test.ts", {
    removed: ["  expect(run()).toBe(1);"],
    added: ["  // assertion removed"],
  });
  const findings = detectForFiles([file], [...ALL_KINDS], 50).filter(
    (item) => item.ruleId === "removed-test-coverage",
  );
  assert.equal(findings.length, 1);
  assert.equal(detectorById("removed-test-coverage")?.provable, false);
  const fixed = detectorFix("removed-test-coverage", "test('a', () => {\n});", findings[0]);
  assert.ok(fixed);
  assert.match(fixed.content, /expect\(run\(\)\)/);
});

test("config-insecure-default detects and removes fallbacks", () => {
  const content = 'const secret = process.env.SESSION_SECRET || "dev-secret";';
  const fixed = assertFixed("config-insecure-default", "server/config.ts", content);
  assert.match(fixed, /process\.env\.SESSION_SECRET \?\? ""/);
});

test("detectForFiles filters by agent kind and limit", () => {
  const files = [
    contentFile("server/users/repo.ts", "db.query(`SELECT * FROM t WHERE id = ${id}`);"),
    contentFile("client/components/C.tsx", "el.innerHTML = body;"),
  ];
  const databaseOnly = detectForFiles(files, ["database"], 50);
  assert.ok(databaseOnly.every((finding) => finding.ruleId === "sql-injection"));
  const limited = detectForFiles(files, [...ALL_KINDS], 1);
  assert.equal(limited.length, 1);
});

test("detectForFiles ignores removed files", () => {
  const removed = contentFile("server/users/repo.ts", "db.query(`SELECT * FROM t WHERE id = ${id}`);", "removed");
  assert.equal(detectForFiles([removed], [...ALL_KINDS], 50).length, 0);
});

test("every detector with a fix leaves no bug behind", () => {
  const samples: Array<[string, string, string]> = [
    ["auth-weak-comparison", "server/auth/session.ts", "if (sessionUserId == userId) { return false; }"],
    ["auth-missing-check", "server/routes/admin.ts", 'router.delete("/api/admin/users/:id", handler);'],
    ["sql-injection", "server/users/repo.ts", "db.query(`SELECT * FROM users WHERE id = ${userId}`);"],
    ["xss-unsafe-html", "client/components/C.tsx", "el.innerHTML = body;"],
    ["hardcoded-secret", "server/config.ts", 'const token = "abcdef123456789";'],
    ["off-by-one-loop", "server/lib/p.ts", "for (let i = 0; i <= items.length; i++) {}"],
    ["unhandled-async-rejection", "server/api/p.ts", "load().then((value) => value);"],
    ["sequential-await-map", "server/analytics/r.ts", "const rows = ids.map(async (id) => await db.query(sql, [id]));"],
    ["config-insecure-default", "server/config.ts", 'const secret = process.env.SECRET || "dev";'],
  ];
  for (const [ruleId, path, content] of samples) {
    assertFixed(ruleId, path, content);
  }
});
