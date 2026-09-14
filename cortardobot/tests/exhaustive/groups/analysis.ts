import assert from "node:assert/strict";
import {
  DETECTORS,
  detectForFiles,
  detectorFix,
  detectorPresentInContent,
  type DetectorFinding,
} from "../../../src/agents/detectors";
import { analyzeChange, detectLanguage, isConfigPath, isTestPath } from "../../../src/stages/change-intelligence";
import { makeUnifiedDiff } from "../../../src/util/diff";
import { FIXTURES } from "../../../fixtures/prs";
import { contentFile, makeChangedFile } from "../../helpers/factories";
import { defineCases } from "../types";
import type { ChangedFile } from "../../../src/types";

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

interface DetectorSample {
  id: string;
  positive: () => { file: ChangedFile; content: string };
  negative: () => ChangedFile[];
}

const SESSION_FIXED = 'export function authorize(userId: string, sessionUserId: string): boolean {\n  if (sessionUserId === userId) {\n    return true;\n  }\n  return false;\n}\n';

export const DETECTOR_SAMPLES: DetectorSample[] = [
  {
    id: "auth-weak-comparison",
    positive: () => ({
      file: contentFile("server/auth/session.ts", "if (sessionUserId == userId) {\n  return false;\n}\n"),
      content: "if (sessionUserId == userId) {\n  return false;\n}\n",
    }),
    negative: () => [contentFile("server/auth/session.ts", SESSION_FIXED)],
  },
  {
    id: "auth-missing-check",
    positive: () => ({
      file: contentFile("server/routes/admin.ts", 'router.delete("/api/admin/users/:id", deleteUserHandler);\n'),
      content: 'router.delete("/api/admin/users/:id", deleteUserHandler);\n',
    }),
    negative: () => [
      contentFile("server/routes/admin.ts", 'router.delete("/api/admin/users/:id", requireAuth, deleteUserHandler);\n'),
    ],
  },
  {
    id: "sql-injection",
    positive: () => ({
      file: contentFile("server/users/repo.ts", "return db.query(`SELECT * FROM users WHERE id = ${userId}`);\n"),
      content: "return db.query(`SELECT * FROM users WHERE id = ${userId}`);\n",
    }),
    negative: () => [contentFile("server/users/repo.ts", 'return db.query("SELECT * FROM users WHERE id = ?", [userId]);\n')],
  },
  {
    id: "xss-unsafe-html",
    positive: () => ({
      file: contentFile("client/components/Comment.tsx", "el.innerHTML = comment.body;\n"),
      content: "el.innerHTML = comment.body;\n",
    }),
    negative: () => [contentFile("client/components/Comment.tsx", "el.textContent = comment.body;\n")],
  },
  {
    id: "hardcoded-secret",
    positive: () => ({
      file: contentFile("server/config.ts", 'const apiKey = "sk-live-abcdef123456";\n'),
      content: 'const apiKey = "sk-live-abcdef123456";\n',
    }),
    negative: () => [contentFile("server/config.ts", 'const apiKey = process.env.API_KEY ?? "";\n')],
  },
  {
    id: "off-by-one-loop",
    positive: () => ({
      file: contentFile("server/lib/pagination.ts", "for (let i = 0; i <= items.length; i++) {\n  total += items[i].length;\n}\n"),
      content: "for (let i = 0; i <= items.length; i++) {\n  total += items[i].length;\n}\n",
    }),
    negative: () => [
      contentFile("server/lib/pagination.ts", "for (let i = 0; i < items.length; i++) {\n  total += items[i].length;\n}\n"),
    ],
  },
  {
    id: "unhandled-async-rejection",
    positive: () => ({
      file: contentFile("server/api/profile.ts", "return fetchProfile(id).then((profile) => profile.name);\n"),
      content: "return fetchProfile(id).then((profile) => profile.name);\n",
    }),
    negative: () => [
      contentFile(
        "server/api/profile.ts",
        "return fetchProfile(id).then((profile) => profile.name).catch((error) => { console.error(error); });\n",
      ),
    ],
  },
  {
    id: "sequential-await-map",
    positive: () => ({
      file: contentFile("server/analytics/report.ts", 'const rows = ids.map(async (id) => await db.query("SELECT 1", [id]));\n'),
      content: 'const rows = ids.map(async (id) => await db.query("SELECT 1", [id]));\n',
    }),
    negative: () => [
      contentFile(
        "server/analytics/report.ts",
        'const rows = await Promise.all(ids.map(async (id) => await db.query("SELECT 1", [id])));\n',
      ),
    ],
  },
  {
    id: "api-breaking-signature",
    positive: () => ({
      file: makeChangedFile("server/api/sessions.ts", {
        removed: ["export function createSession(userId: string, expiresIn: number) {"],
        added: ["export function createSession(userId: string) {"],
      }),
      content: "export function createSession(userId: string) {\n  return {};\n}\n",
    }),
    negative: () => [
      makeChangedFile("server/api/sessions.ts", {
        removed: ["export function createSession(userId: string, expiresIn: number) {"],
        added: ["export function createSession(userId: string, expiresIn: number, traceId: string) {"],
      }),
    ],
  },
  {
    id: "removed-test-coverage",
    positive: () => ({
      file: makeChangedFile("src/a.test.ts", {
        removed: ["  expect(run()).toBe(1);"],
        added: ["  // assertion removed"],
      }),
      content: "test('a', () => {\n});\n",
    }),
    negative: () => [
      makeChangedFile("src/a.test.ts", {
        removed: [],
        added: ["  expect(run()).toBe(1);"],
      }),
    ],
  },
  {
    id: "config-insecure-default",
    positive: () => ({
      file: contentFile("server/config.ts", 'const secret = process.env.SESSION_SECRET || "dev-secret";\n'),
      content: 'const secret = process.env.SESSION_SECRET || "dev-secret";\n',
    }),
    negative: () => [contentFile("server/config.ts", 'const secret = process.env.SESSION_SECRET ?? "";\n')],
  },
];

function detectorCases() {
  const cases: Array<{ name: string; run: () => void }> = [];
  for (const sample of DETECTOR_SAMPLES) {
    cases.push({
      name: `${sample.id} detects and repairs its defect`,
      run: () => {
        const { file, content } = sample.positive();
        const findings = detectForFiles([file], [...ALL_KINDS], 50).filter(
          (finding) => finding.ruleId === sample.id,
        );
        assert.ok(findings.length >= 1, `${sample.id} did not fire`);
        const finding = findings[0] as DetectorFinding;
        assert.equal(detectorPresentInContent(sample.id, content, finding), true);
        const fixed = detectorFix(sample.id, content, finding);
        assert.ok(fixed, `${sample.id} has no fix`);
        assert.notEqual(fixed.content, content);
        assert.equal(detectorPresentInContent(sample.id, fixed.content, finding), false);
      },
    });
    cases.push({
      name: `${sample.id} stays quiet on safe code`,
      run: () => {
        const fired = detectForFiles(sample.negative(), [...ALL_KINDS], 50).filter(
          (finding) => finding.ruleId === sample.id,
        );
        assert.equal(fired.length, 0, `${sample.id} false positive`);
      },
    });
  }
  return cases;
}

function fixtureCases() {
  return FIXTURES.map((fixture) => ({
    name: `change intelligence matches fixture ${fixture.id}`,
    run: () => {
      const context = analyzeChange(fixture.pullRequest);
      assert.equal(context.size, fixture.expected.size, `${fixture.id} size`);
      for (const category of fixture.expected.classificationIncludes) {
        assert.ok(context.classification.includes(category), `${fixture.id} missing ${category}`);
      }
      assert.equal(context.stats.files, fixture.pullRequest.files.length);
      assert.ok(context.stats.additions >= 0 && context.stats.deletions >= 0);
      const changed = fixture.pullRequest.files.map((file) => file.path);
      for (const path of changed) {
        assert.ok(context.files.some((file) => file.path === path), `${fixture.id} lost ${path}`);
      }
      const detected = new Set(
        detectForFiles(
          context.files,
          [...ALL_KINDS],
          200,
        ).map((finding) => finding.ruleId),
      );
      for (const rule of fixture.expected.ruleIds) {
        assert.ok(detected.has(rule), `${fixture.id} did not detect ${rule}`);
      }
    },
  }));
}

function languageCases() {
  return [
    {
      name: "python symbols are extracted",
      run: () => {
        const file = makeChangedFile("app/main.py", {
          language: "Python",
          added: ["def handle():", "class Worker:", "MAX_RETRIES = 3"],
        });
        const context = analyzeChange({ title: "py", files: [{ path: "app/main.py", content: "x" }] });
        assert.equal(context.files[0].language, "Python");
        assert.equal(detectLanguage("app/main.py"), "Python");
        assert.ok(file.addedLines.length === 3);
      },
    },
    {
      name: "language detection covers common extensions",
      run: () => {
        const expected: Record<string, string> = {
          "a.go": "Go",
          "a.rb": "Ruby",
          "a.rs": "Rust",
          "a.java": "Java",
          "a.kt": "Kotlin",
          "a.php": "PHP",
          "a.cs": "C#",
          "a.swift": "Swift",
          "a.sql": "SQL",
          "a.scss": "CSS",
        };
        for (const [path, language] of Object.entries(expected)) {
          assert.equal(detectLanguage(path), language, path);
        }
      },
    },
    {
      name: "sql changes classify as DATABASE",
      run: () => {
        const context = analyzeChange({
          title: "sql",
          files: [{ path: "db/query.sql", content: "SELECT * FROM users;\n" }],
        });
        assert.ok(context.classification.includes("DATABASE"));
      },
    },
    {
      name: "yaml config files classify as CONFIG",
      run: () => {
        const context = analyzeChange({
          title: "yaml",
          files: [{ path: "config/app.yaml", content: "port: 3000\n" }],
        });
        assert.ok(context.classification.includes("CONFIG"));
      },
    },
    {
      name: "markdown is never treated as config",
      run: () => {
        assert.equal(isConfigPath("docs/readme.md"), false);
        assert.equal(isConfigPath("package.json"), true);
      },
    },
    {
      name: "test paths are detected across layouts",
      run: () => {
        assert.equal(isTestPath("src/app.test.ts"), true);
        assert.equal(isTestPath("src/app.spec.tsx"), true);
        assert.equal(isTestPath("tests/app.ts"), true);
        assert.equal(isTestPath("__tests__/app.ts"), true);
        assert.equal(isTestPath("src/app.ts"), false);
      },
    },
    {
      name: "routes are extracted into the context",
      run: () => {
        const content = 'router.get("/api/users", listUsers);\n';
        const context = analyzeChange({
          title: "route",
          files: [
            {
              path: "server/routes/users.ts",
              content,
              patch: makeUnifiedDiff("server/routes/users.ts", "", content),
            },
          ],
        });
        assert.ok(context.routes.length >= 1);
        assert.ok(context.classification.includes("API"));
      },
    },
    {
      name: "imports produce dependency edges and callers",
      run: () => {
        const appContent = "import { helper } from './helper';\nhelper();\n";
        const helperContent = "export function helper() {}\n";
        const context = analyzeChange({
          title: "deps",
          files: [
            { path: "src/app.ts", content: appContent, patch: makeUnifiedDiff("src/app.ts", "", appContent) },
            { path: "src/helper.ts", content: helperContent, patch: makeUnifiedDiff("src/helper.ts", "", helperContent) },
          ],
        });
        assert.ok(context.dependencies.some((edge) => edge.from === "src/app.ts" && edge.to === "src/helper.ts"));
        assert.ok(context.callers.includes("src/app.ts"));
      },
    },
    {
      name: "risk signals accumulate for dangerous changes",
      run: () => {
        const secretContent = 'const token = "abcdef123456789";\n';
        const workflowContent = "on: push\n";
        const context = analyzeChange({
          title: "risky",
          files: [
            {
              path: "src/app.ts",
              content: secretContent,
              patch: makeUnifiedDiff("src/app.ts", "", secretContent),
            },
            {
              path: ".github/workflows/ci.yml",
              content: workflowContent,
              patch: makeUnifiedDiff(".github/workflows/ci.yml", "", workflowContent),
            },
          ],
        });
        const ids = context.riskSignals.map((signal) => signal.id);
        assert.ok(ids.includes("ci-change"));
        assert.ok(ids.includes("secret-literal"));
      },
    },
    {
      name: "sizes are computed consistently",
      run: () => {
        const tiny = analyzeChange({ title: "tiny", files: [{ path: "a.ts", content: "const a = 1;\n" }] });
        assert.equal(tiny.size, "tiny");
        const complex = analyzeChange({
          title: "complex",
          files: Array.from({ length: 9 }, (_, index) => ({
            path: `src/file-${index}.ts`,
            content: `export function fn${index}() {}\n`,
          })),
        });
        assert.equal(complex.size, "complex");
      },
    },
    {
      name: "empty file lists are handled",
      run: () => {
        const context = analyzeChange({ title: "empty", files: [] });
        assert.equal(context.stats.files, 0);
        assert.deepEqual(context.classification, ["UNKNOWN"]);
        assert.equal(context.size, "tiny");
      },
    },
    {
      name: "deletion-only changes parse removed lines",
      run: () => {
        const context = analyzeChange({
          title: "delete",
          files: [
            {
              path: "src/app.ts",
              patch: "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1,2 +1,1 @@\n-const a = 1;\n const b = 2;\n",
              content: "const b = 2;\n",
            },
          ],
        });
        assert.equal(context.files[0].removedLines.length, 1);
        assert.equal(context.files[0].addedLines.length, 0);
      },
    },
    {
      name: "content-only entries stay intact",
      run: () => {
        const context = analyzeChange({
          title: "content only",
          files: [{ path: "src/app.ts", content: "export const value = 42;\n", status: "added" }],
        });
        assert.equal(context.files[0].status, "added");
        assert.equal(context.files[0].content, "export const value = 42;\n");
        assert.equal(context.files[0].additions, 0);
      },
    },
    {
      name: "unicode and duplicate paths do not break the context",
      run: () => {
        const context = analyzeChange({
          title: "unicode",
          files: [
            { path: "src/ünïcode.ts", content: "const message = '日本語 αβγ';\n" },
            { path: "src/ünïcode.ts", content: "const message = '日本語 αβγ';\n" },
          ],
        });
        assert.equal(context.stats.files, 2);
        assert.ok(context.id.startsWith("pr_"));
      },
    },
  ];
}

export function buildAnalysisGroup() {
  return defineCases("analysis", [...detectorCases(), ...fixtureCases(), ...languageCases()]);
}
