import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeChange,
  classifyPR,
  computeSize,
  detectLanguage,
  detectRiskSignals,
  extractDependencies,
  extractSymbols,
  isConfigPath,
  isTestPath,
  parseChangedFiles,
  resolveImport,
} from "../../src/stages/change-intelligence";
import { makeChangedFile } from "../helpers/factories";
import { makeUnifiedDiff } from "../../src/util/diff";

function patchFile(path: string, oldContent: string, newContent: string) {
  return {
    path,
    patch: makeUnifiedDiff(path, oldContent, newContent),
    content: newContent,
  };
}

test("detectLanguage maps extensions", () => {
  assert.equal(detectLanguage("a.ts"), "TypeScript");
  assert.equal(detectLanguage("a.tsx"), "TypeScript");
  assert.equal(detectLanguage("a.py"), "Python");
  assert.equal(detectLanguage("a.go"), "Go");
  assert.equal(detectLanguage("a.unknown"), "Unknown");
});

test("isTestPath detects common test layouts", () => {
  assert.equal(isTestPath("src/a.test.ts"), true);
  assert.equal(isTestPath("src/a.spec.tsx"), true);
  assert.equal(isTestPath("tests/a.ts"), true);
  assert.equal(isTestPath("__tests__/a.ts"), true);
  assert.equal(isTestPath("src/a.ts"), false);
});

test("isConfigPath detects configuration files but not docs", () => {
  assert.equal(isConfigPath("package.json"), true);
  assert.equal(isConfigPath(".env"), true);
  assert.equal(isConfigPath("docker-compose.yml"), true);
  assert.equal(isConfigPath("server/config.ts"), true);
  assert.equal(isConfigPath("README.md"), false);
  assert.equal(isConfigPath("src/app.ts"), false);
});

test("parseChangedFiles extracts added and removed line numbers", () => {
  const oldContent = "a\nb\nc\n";
  const newContent = "a\nB\nc\nd\n";
  const files = parseChangedFiles([patchFile("src/f.ts", oldContent, newContent)]);
  assert.equal(files.length, 1);
  assert.equal(files[0].additions, 2);
  assert.equal(files[0].deletions, 1);
  assert.deepEqual(files[0].addedLines.map((line) => line.text), ["B", "d"]);
  assert.deepEqual(files[0].removedLines.map((line) => line.text), ["b"]);
  assert.equal(files[0].addedLines[0].line, 2);
  assert.equal(files[0].addedLines[1].line, 4);
  assert.equal(files[0].removedLines[0].line, 2);
});

test("parseChangedFiles handles files with no patch", () => {
  const files = parseChangedFiles([{ path: "./src/x.ts", status: "added", content: "export const x = 1;\n" }]);
  assert.equal(files[0].path, "src/x.ts");
  assert.equal(files[0].additions, 0);
});

test("extractSymbols finds TypeScript declarations", () => {
  const file = makeChangedFile("src/symbols.ts", {
    added: [
      "export function run() { return 1; }",
      "export class Service {}",
      "export interface Config {}",
      "type Alias = string;",
      "export const VALUE = 1;",
      "const arrow = () => 1;",
    ],
  });
  const symbols = extractSymbols(file);
  const names = symbols.map((symbol) => `${symbol.kind}:${symbol.name}`);
  assert.ok(names.includes("function:run"));
  assert.ok(names.includes("class:Service"));
  assert.ok(names.includes("interface:Config"));
  assert.ok(names.includes("type:Alias"));
  assert.ok(names.includes("const:VALUE"));
  assert.ok(names.includes("const:arrow"));
});

test("extractSymbols finds routes and tests", () => {
  const routeFile = makeChangedFile("server/routes.ts", {
    added: ['router.delete("/api/admin/users/:id", handler);'],
  });
  const routes = extractSymbols(routeFile);
  assert.equal(routes[0].kind, "route");
  assert.match(routes[0].name, /DELETE \/api\/admin\/users\/:id/);

  const testFile = makeChangedFile("src/a.test.ts", { added: ['it("works", () => {});'] });
  const tests = extractSymbols(testFile);
  assert.equal(tests[0].kind, "test");
  assert.equal(tests[0].name, "works");
});

test("extractSymbols handles Python", () => {
  const file = makeChangedFile("app/main.py", {
    language: "Python",
    added: ["def handle():", "class Worker:", "MAX_RETRIES = 3"],
  });
  const names = extractSymbols(file).map((symbol) => `${symbol.kind}:${symbol.name}`);
  assert.ok(names.includes("function:handle"));
  assert.ok(names.includes("class:Worker"));
  assert.ok(names.includes("const:MAX_RETRIES"));
});

test("extractSymbols marks modified when added and removed match", () => {
  const file = makeChangedFile("src/a.ts", {
    added: ["export function run() {}"],
    removed: ["export function run() { return 1; }"],
  });
  const symbols = extractSymbols(file);
  assert.equal(symbols.find((symbol) => symbol.name === "run")?.change, "modified");
});

test("resolveImport resolves relative, index and extensionless paths", () => {
  const known = ["src/app.ts", "src/shared/helper.ts", "src/shared/index.ts"];
  assert.equal(resolveImport("src/app.ts", "./shared/helper", known), "src/shared/helper.ts");
  assert.equal(resolveImport("src/app.ts", "./shared", known), "src/shared/index.ts");
  assert.equal(resolveImport("src/app.ts", "react", known), undefined);
  assert.equal(resolveImport("src/deep/app.ts", "../app", known), "src/app.ts");
});

test("extractDependencies links imports and python relative imports", () => {
  const files = [
    makeChangedFile("src/app.ts", { added: ["import { helper } from './helper';", "helper();"] }),
    makeChangedFile("src/helper.ts", { added: ["export function helper() {}"] }),
    makeChangedFile("pkg/main.py", { language: "Python", added: ["from .util import helper"] }),
    makeChangedFile("pkg/util.py", { language: "Python", added: ["def helper(): pass"] }),
  ];
  const edges = extractDependencies(files);
  assert.ok(edges.some((edge) => edge.from === "src/app.ts" && edge.to === "src/helper.ts" && edge.kind === "imports"));
  assert.ok(edges.some((edge) => edge.from === "pkg/main.py" && edge.to === "pkg/util.py"));
});

test("detectRiskSignals flags dangerous patterns", () => {
  const files = [
    makeChangedFile("server/config.ts", { added: ['const apiKey = "sk-live-abcdef123456";'] }),
    makeChangedFile("migrations/001.sql", { added: ["ALTER TABLE users ADD COLUMN age int;"], language: "SQL" }),
    makeChangedFile("src/a.test.ts", { removed: ["expect(run()).toBe(1);"], added: [] }),
    makeChangedFile(".github/workflows/ci.yml", { added: ["on: push"] }),
    makeChangedFile("package-lock.json", { added: ["{}"] }),
  ];
  const signals = detectRiskSignals(files, []);
  const ids = signals.map((signal) => signal.id);
  assert.ok(ids.includes("secret-literal"));
  assert.ok(ids.includes("db-migration"));
  assert.ok(ids.includes("removed-tests"));
  assert.ok(ids.includes("ci-change"));
  assert.ok(ids.includes("lockfile-change"));
});

test("detectRiskSignals flags removed exported symbols and net deletions", () => {
  const file = makeChangedFile("src/a.ts", {
    removed: Array.from({ length: 40 }, (_, index) => `export function fn${index}() {}`),
    added: ["export function only() {}"],
  });
  const symbols = extractSymbols(file);
  const signals = detectRiskSignals([file], symbols);
  const ids = signals.map((signal) => signal.id);
  assert.ok(ids.includes("api-signature"));
  assert.ok(ids.includes("net-deletion"));
});

test("classifyPR picks AUTH for auth changes", () => {
  const context = {
    files: [makeChangedFile("server/auth/session.ts", { added: ["if (session.userId == userId) return null;"] })],
    symbols: [],
    routes: [],
    riskSignals: [],
  };
  assert.ok(classifyPR(context).includes("AUTH"));
});

test("classifyPR picks DATABASE, UI, PERFORMANCE and CONFIG", () => {
  assert.ok(
    classifyPR({
      files: [makeChangedFile("db/repository.ts", { added: ['db.query("SELECT 1");'] })],
      symbols: [],
      routes: [],
      riskSignals: [],
    }).includes("DATABASE"),
  );
  assert.ok(
    classifyPR({
      files: [makeChangedFile("client/components/Button.tsx", { added: ["export function Button() {}"] })],
      symbols: [],
      routes: [],
      riskSignals: [],
    }).includes("UI"),
  );
  assert.ok(
    classifyPR({
      files: [makeChangedFile("server/cache.ts", { added: ["const cached = memoize(load);"] })],
      symbols: [],
      routes: [],
      riskSignals: [],
    }).includes("PERFORMANCE"),
  );
  assert.ok(
    classifyPR({
      files: [makeChangedFile("vite.config.ts", { added: ["export default {}"] })],
      symbols: [],
      routes: [],
      riskSignals: [],
    }).includes("CONFIG"),
  );
});

test("classifyPR returns UNKNOWN when nothing matches", () => {
  assert.deepEqual(
    classifyPR({
      files: [makeChangedFile("src/util.ts", { added: ["const x = 1;"] })],
      symbols: [],
      routes: [],
      riskSignals: [],
    }),
    ["UNKNOWN"],
  );
});

test("classifyPR caps output at three categories sorted by score", () => {
  const result = classifyPR({
    files: [
      makeChangedFile("server/auth/session.ts", { added: ["session.token = jwt.sign(payload);"] }),
      makeChangedFile("server/routes/users.ts", { added: ["router.get('/users', handler);"] }),
      makeChangedFile("db/migrations/001.ts", { added: ['db.query("SELECT * FROM users");'] }),
      makeChangedFile("client/components/App.tsx", { added: ["el.innerHTML = html;"] }),
      makeChangedFile("config/app.yaml", { added: ["cache: true"] }),
    ],
    symbols: [],
    routes: ["GET /users"],
    riskSignals: [],
  });
  assert.equal(result.length, 3);
});

test("computeSize classifies tiny, normal and complex", () => {
  assert.equal(computeSize({ files: 1, additions: 10, deletions: 5 }, []), "tiny");
  assert.equal(computeSize({ files: 4, additions: 120, deletions: 80 }, []), "normal");
  assert.equal(computeSize({ files: 9, additions: 50, deletions: 50 }, []), "complex");
  assert.equal(
    computeSize({ files: 3, additions: 60, deletions: 30 }, [
      { id: "a", detail: "", weight: 5 },
      { id: "b", detail: "", weight: 4 },
    ]),
    "complex",
  );
});

test("analyzeChange builds a complete context", () => {
  const input = {
    id: "pr-1",
    title: "Fix session check",
    body: "Fixes ownership validation",
    files: [
      patchFile(
        "server/auth/session.ts",
        "export function authorize(a, b) { return a !== b; }\n",
        "export function authorize(session, b) { return session.userId == b; }\n",
      ),
      {
        path: "server/auth/session.test.ts",
        patch: makeUnifiedDiff(
          "server/auth/session.test.ts",
          "test('a', () => {});\n",
          "test('a', () => {});\ntest('b', () => {});\n",
        ),
      },
    ],
  };
  const context = analyzeChange(input);
  assert.equal(context.id.startsWith("pr_"), true);
  assert.equal(context.stats.files, 2);
  assert.equal(context.stats.additions, 2);
  assert.equal(context.stats.deletions, 1);
  assert.equal(context.tests.length, 1);
  assert.ok(context.classification.includes("AUTH"));
  assert.equal(context.size, "tiny");
  assert.ok(context.riskSignals.some((signal) => signal.id === "auth-surface"));
});
