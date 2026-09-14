import assert from "node:assert/strict";
import {
  analyzeChange,
  classifyPR,
  computeSize,
  detectRiskSignals,
  extractDependencies,
  extractSymbols,
  parseChangedFiles,
} from "../../../src/stages/change-intelligence";
import { makeChangedFile, makeContext } from "../../helpers/factories";
import { makeUnifiedDiff } from "../../../src/util/diff";
import { defineCases } from "../../exhaustive/types";

function patchFile(path: string, before: string, after: string) {
  return { path, content: after, patch: makeUnifiedDiff(path, before, after) };
}

const LONG_BEFORE = Array.from({ length: 30 }, (_, index) => `const line${index} = ${index};`).join("\n") + "\n";

export function buildIntelligenceDeepGroup() {
  return defineCases("intelligence-deep", [
    {
      name: "multi-hunk added line numbers are exact",
      run: () => {
        const before = `${LONG_BEFORE}`;
        const after = before.replace("const line1 = 1;", "const line1 = 11;").replace("const line25 = 25;", "const line25 = 255;");
        const files = parseChangedFiles([patchFile("src/a.ts", before, after)]);
        const added = files[0].addedLines;
        assert.deepEqual(added.map((line) => line.line), [2, 26]);
      },
    },
    {
      name: "multi-hunk removed line numbers are exact",
      run: () => {
        const before = `${LONG_BEFORE}`;
        const after = before.replace("const line1 = 1;", "const line1 = 11;").replace("const line25 = 25;", "const line25 = 255;");
        const files = parseChangedFiles([patchFile("src/a.ts", before, after)]);
        assert.deepEqual(files[0].removedLines.map((line) => line.line), [2, 26]);
      },
    },
    {
      name: "additions and deletions are counted",
      run: () => {
        const files = parseChangedFiles([patchFile("src/a.ts", "a\nb\nc\n", "a\nB\nc\nd\n")]);
        assert.equal(files[0].additions, 2);
        assert.equal(files[0].deletions, 1);
      },
    },
    {
      name: "symbols mark added and removed as modified",
      run: () => {
        const file = makeChangedFile("src/a.ts", {
          added: ["export function run() { return 2; }"],
          removed: ["export function run() { return 1; }"],
        });
        const symbol = extractSymbols(file).find((item) => item.name === "run");
        assert.equal(symbol?.change, "modified");
      },
    },
    {
      name: "duplicate symbol declarations collapse",
      run: () => {
        const file = makeChangedFile("src/a.ts", {
          added: ["export function run() {}", "export function run() { return 1; }"],
        });
        const runs = extractSymbols(file).filter((item) => item.name === "run");
        assert.equal(runs.length, 1);
      },
    },
    {
      name: "python constants are extracted",
      run: () => {
        const file = makeChangedFile("app/config.py", { language: "Python", added: ["MAX_RETRIES = 3"] });
        assert.ok(extractSymbols(file).some((symbol) => symbol.name === "MAX_RETRIES"));
      },
    },
    {
      name: "route symbols carry the verb and path",
      run: () => {
        const file = makeChangedFile("server/routes.ts", {
          added: ['router.post("/api/users", createUser);'],
        });
        const route = extractSymbols(file)[0];
        assert.equal(route.kind, "route");
        assert.equal(route.name, "POST /api/users");
      },
    },
    {
      name: "test names are extracted from test files",
      run: () => {
        const file = makeChangedFile("src/a.test.ts", { added: ['describe("session", () => {});'] });
        const symbol = extractSymbols(file)[0];
        assert.equal(symbol.kind, "test");
        assert.equal(symbol.name, "session");
      },
    },
    {
      name: "index imports resolve",
      run: () => {
        const context = analyzeChange({
          title: "index",
          files: [
            patchFile("src/app.ts", "", "import { helper } from './helpers';\n"),
            { path: "src/helpers/index.ts", content: "export const helper = 1;\n" },
          ],
        });
        assert.ok(context.dependencies.some((edge) => edge.to === "src/helpers/index.ts"));
      },
    },
    {
      name: "extensionless imports resolve",
      run: () => {
        const context = analyzeChange({
          title: "ext",
          files: [
            patchFile("src/app.ts", "", "import { helper } from './helper';\n"),
            { path: "src/helper.ts", content: "export const helper = 1;\n" },
          ],
        });
        assert.ok(context.dependencies.some((edge) => edge.to === "src/helper.ts"));
      },
    },
    {
      name: "parent relative imports resolve",
      run: () => {
        const context = analyzeChange({
          title: "parent",
          files: [
            patchFile("src/deep/app.ts", "", "import { config } from '../config';\n"),
            { path: "src/config.ts", content: "export const config = {};\n" },
          ],
        });
        assert.ok(context.dependencies.some((edge) => edge.to === "src/config.ts"));
      },
    },
    {
      name: "python relative imports resolve",
      run: () => {
        const fileA = makeChangedFile("pkg/main.py", { language: "Python", added: ["from .util import helper"] });
        const fileB = makeChangedFile("pkg/util.py", { language: "Python", added: ["def helper(): pass"] });
        const edges = extractDependencies([fileA, fileB]);
        assert.ok(edges.some((edge) => edge.from === "pkg/main.py" && edge.to === "pkg/util.py"));
      },
    },
    {
      name: "external imports are ignored",
      run: () => {
        const file = makeChangedFile("src/app.ts", { added: ["import { x } from 'react';"] });
        assert.equal(extractDependencies([file]).length, 0);
      },
    },
    {
      name: "duplicate dependency edges collapse",
      run: () => {
        const fileA = makeChangedFile("src/app.ts", {
          added: ["import { helper } from './helper';", "import { helper } from './helper';"],
        });
        const fileB = makeChangedFile("src/helper.ts", { added: ["export const helper = 1;"] });
        assert.equal(extractDependencies([fileA, fileB]).length, 1);
      },
    },
    {
      name: "callers are computed from imports",
      run: () => {
        const context = analyzeChange({
          title: "callers",
          files: [
            patchFile("src/app.ts", "", "import { run } from './runner';\nrun();\n"),
            patchFile("src/runner.ts", "", "export function run() {}\n"),
          ],
        });
        assert.ok(context.callers.includes("src/app.ts"));
      },
    },
    {
      name: "changed test files appear in context tests",
      run: () => {
        const context = analyzeChange({
          title: "tests",
          files: [patchFile("src/app.test.ts", "test('a', () => {});\n", "test('a', () => {});\ntest('b', () => {});\n")],
        });
        assert.ok(context.tests.includes("src/app.test.ts"));
      },
    },
    {
      name: "config files are collected",
      run: () => {
        const context = analyzeChange({
          title: "config",
          files: [patchFile("tsconfig.json", "{}", '{ "strict": true }')],
        });
        assert.ok(context.configFiles.includes("tsconfig.json"));
      },
    },
    {
      name: "routes are collected into the context",
      run: () => {
        const context = analyzeChange({
          title: "routes",
          files: [patchFile("server/routes.ts", "", 'router.get("/api/health", health);\n')],
        });
        assert.ok(context.routes.length >= 1);
      },
    },
    {
      name: "classification is capped at three categories",
      run: () => {
        const classification = classifyPR({
          files: [
            makeChangedFile("server/auth/session.ts", { added: ["session.token = jwt.sign(payload);"] }),
            makeChangedFile("server/routes/users.ts", { added: ["router.get('/users', handler);"] }),
            makeChangedFile("db/repository.ts", { added: ['db.query("SELECT * FROM users");'] }),
            makeChangedFile("client/components/App.tsx", { added: ["el.innerHTML = html;"] }),
            makeChangedFile("config/app.yaml", { added: ["cache: true"] }),
          ],
          symbols: [],
          routes: ["GET /users"],
          riskSignals: [],
        });
        assert.equal(classification.length, 3);
      },
    },
    {
      name: "secret literals produce a weight-3 signal",
      run: () => {
        const file = makeChangedFile("server/config.ts", { added: ['const token = "abcdef123456789";'] });
        const signal = detectRiskSignals([file], []).find((item) => item.id === "secret-literal");
        assert.equal(signal?.weight, 3);
      },
    },
    {
      name: "removed test assertions produce a signal",
      run: () => {
        const file = makeChangedFile("src/a.test.ts", { removed: ["expect(run()).toBe(1);"], added: [] });
        const signal = detectRiskSignals([file], []).find((item) => item.id === "removed-tests");
        assert.equal(signal?.weight, 3);
      },
    },
    {
      name: "migration changes produce a database signal",
      run: () => {
        const context = analyzeChange({
          title: "migration",
          files: [patchFile("migrations/001.sql", "", "ALTER TABLE users ADD COLUMN age int;\n")],
        });
        assert.ok(context.riskSignals.some((signal) => signal.id === "db-migration"));
      },
    },
    {
      name: "removed exported symbols produce an api signal",
      run: () => {
        const context = analyzeChange({
          title: "api",
          files: [
            patchFile(
              "src/api.ts",
              "export function createUser(name: string) {}\nexport function deleteUser(id: string) {}\n",
              "export function createUser(name: string) {}\n",
            ),
          ],
        });
        assert.ok(context.riskSignals.some((signal) => signal.id === "api-signature"));
      },
    },
    {
      name: "net deletions produce a signal",
      run: () => {
        const before = Array.from({ length: 50 }, (_, index) => `const line${index} = ${index};`).join("\n") + "\n";
        const after = "const line0 = 0;\n";
        const context = analyzeChange({ title: "delete", files: [patchFile("src/a.ts", before, after)] });
        assert.ok(context.riskSignals.some((signal) => signal.id === "net-deletion"));
      },
    },
    {
      name: "risk signals are ordered by weight",
      run: () => {
        const context = analyzeChange({
          title: "risk",
          files: [patchFile("src/a.ts", "", 'const token = "abcdef123456789";\nconst x = 1;\n')],
        });
        const weights = context.riskSignals.map((signal) => signal.weight);
        assert.deepEqual(weights, [...weights].sort((a, b) => b - a));
      },
    },
    {
      name: "size boundary stays tiny at two files and forty lines",
      run: () => assert.equal(computeSize({ files: 2, additions: 40, deletions: 0 }, []), "tiny"),
    },
    {
      name: "size boundary becomes normal beyond the tiny window",
      run: () => assert.equal(computeSize({ files: 3, additions: 41, deletions: 0 }, []), "normal"),
    },
    {
      name: "risk escalates a mid-size change to complex",
      run: () => assert.equal(computeSize({ files: 3, additions: 30, deletions: 30 }, [{ id: "x", detail: "", weight: 9 }]), "complex"),
    },
    {
      name: "stats changed lines equal additions plus deletions",
      run: () => {
        const context = analyzeChange({ title: "stats", files: [patchFile("src/a.ts", "a\nb\nc\n", "a\nB\nc\nd\n")] });
        assert.equal(context.stats.changedLines, context.stats.additions + context.stats.deletions);
      },
    },
    {
      name: "context ids are stable for identical input",
      run: () => {
        const input = { title: "stable", files: [patchFile("src/a.ts", "a\n", "b\n")] };
        assert.equal(analyzeChange(input).id, analyzeChange(input).id);
      },
    },
    {
      name: "context ids differ when files differ",
      run: () => {
        const first = analyzeChange({ title: "stable", files: [patchFile("src/a.ts", "a\n", "b\n")] });
        const second = analyzeChange({ title: "stable", files: [patchFile("src/c.ts", "a\n", "b\n")] });
        assert.notEqual(first.id, second.id);
      },
    },
    {
      name: "repository rules flow through the context",
      run: () => {
        const context = analyzeChange({
          title: "rules",
          files: [],
          repoRules: ["never log secrets", "prefer const"],
        });
        assert.deepEqual(context.repoRules, ["never log secrets", "prefer const"]);
        assert.ok(makeContext({ repoRules: ["x"] }).repoRules.includes("x"));
      },
    },
  ]);
}
