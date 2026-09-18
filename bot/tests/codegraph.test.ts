import assert from "node:assert/strict";
import test from "node:test";
import type { CodeGraphSymbol, CodeGraphSymbolEdge } from "@shared/codegraph";
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import { buildCodegraphReport } from "../src/codegraph.ts";
import { buildCodegraphComment, CODEGRAPH_MARKER } from "../src/markdown.ts";
import type { RepoGraphIndex } from "../src/types.ts";

function symbol(
  fileId: string,
  name: string,
  overrides: Partial<CodeGraphSymbol> = {},
): CodeGraphSymbol {
  return {
    id: `${fileId}#${name}`,
    fileId,
    name,
    qualifiedName: name,
    kind: "function",
    line: 1,
    endLine: 10,
    signature: `function ${name}()`,
    exported: true,
    parent: null,
    ...overrides,
  };
}

function analysis(path: string, overrides: Partial<FileAnalysis> = {}): FileAnalysis {
  return {
    analyzeVersion: 3,
    path,
    language: "TypeScript",
    kind: "source",
    loc: 20,
    imports: [],
    namespaces: [],
    calls: [],
    types: [],
    declarations: [],
    symbols: [],
    symbolCalls: [],
    ...overrides,
  };
}

function indexFixture(): RepoGraphIndex {
  const symbols = [
    symbol("src/pricing.ts", "price"),
    symbol("src/pricing.ts", "discount"),
    symbol("src/cart.ts", "total"),
    symbol("src/util.ts", "clamp"),
  ];
  const symbolEdges: CodeGraphSymbolEdge[] = [
    { source: "src/cart.ts#total", target: "src/pricing.ts#price", kind: "calls" },
    { source: "src/pricing.ts#price", target: "src/util.ts#clamp", kind: "calls" },
  ];
  return {
    commitSha: "3f7d3774f15816cafc6119ef71805a890488bfb3",
    files: [
      { id: "src/pricing.ts", path: "src/pricing.ts", language: "TypeScript", kind: "source", loc: 40 },
      { id: "src/cart.ts", path: "src/cart.ts", language: "TypeScript", kind: "source", loc: 30 },
      { id: "src/util.ts", path: "src/util.ts", language: "TypeScript", kind: "source", loc: 12 },
      { id: "src/pricing.test.ts", path: "src/pricing.test.ts", language: "TypeScript", kind: "test", loc: 50 },
    ],
    connections: [
      { source: "src/cart.ts", target: "src/pricing.ts", kind: "imports" },
      { source: "src/pricing.ts", target: "src/util.ts", kind: "imports" },
      { source: "src/pricing.test.ts", target: "src/pricing.ts", kind: "imports" },
    ],
    symbols,
    symbolEdges,
  };
}

test("builds a per-file graph with symbols, edges and likely tests", () => {
  const report = buildCodegraphReport({
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "a9a43b844bc406a7db6266a338af8c1de09786fe",
    files: [
      { path: "src/pricing.ts", status: "modified", additions: 12, deletions: 2 },
      { path: "README.md", status: "modified", additions: 3, deletions: 0 },
    ],
    analyses: new Map([
      [
        "src/pricing.ts",
        analysis("src/pricing.ts", { symbols: [symbol("src/pricing.ts", "price")] }),
      ],
    ]),
    index: indexFixture(),
  });

  assert.equal(report.totals.files, 1);
  assert.equal(report.totals.indexed, 1);
  assert.equal(report.totals.symbols, 1);
  assert.deepEqual(report.unsupported, ["README.md"]);

  const pricing = report.files[0];
  assert.equal(pricing.path, "src/pricing.ts");
  assert.equal(pricing.indexed, true);
  assert.deepEqual(pricing.imports, [{ path: "src/util.ts", changed: false }]);
  assert.deepEqual(pricing.importedBy, ["src/cart.ts", "src/pricing.test.ts"]);
  assert.deepEqual(pricing.callers, [{ symbol: "total", file: "src/cart.ts", via: "price" }]);
  assert.deepEqual(pricing.callees, [{ symbol: "clamp", file: "src/util.ts" }]);
  assert.deepEqual(pricing.tests, ["src/pricing.test.ts"]);
});

test("truncates the changed file list and records a warning", () => {
  const report = buildCodegraphReport({
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "abc",
    files: [
      { path: "a.ts", status: "added", additions: 1, deletions: 0 },
      { path: "b.ts", status: "added", additions: 1, deletions: 0 },
    ],
    analyses: new Map([
      ["a.ts", analysis("a.ts", { symbols: [symbol("a.ts", "a")] })],
      ["b.ts", analysis("b.ts", { symbols: [symbol("b.ts", "b")] })],
    ]),
    index: null,
    maxFiles: 1,
  });

  assert.equal(report.files.length, 1);
  assert.ok(report.warnings.some((warning) => warning.includes("showing 1 of 2 changed files")));
  assert.ok(report.warnings.some((warning) => warning.includes("no ready code index")));
  assert.equal(report.indexCommitSha, null);
});

test("flags changed files that are not in the index", () => {
  const report = buildCodegraphReport({
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "a9a43b84",
    files: [{ path: "src/new.ts", status: "added", additions: 9, deletions: 0 }],
    analyses: new Map([
      ["src/new.ts", analysis("src/new.ts", { symbols: [symbol("src/new.ts", "fresh")] })],
    ]),
    index: indexFixture(),
  });

  assert.deepEqual(report.missingFromIndex, ["src/new.ts"]);
  assert.equal(report.files[0].indexed, false);
  assert.ok(report.warnings.some((warning) => warning.includes("not in the index")));
});

test("renders the stage comment with marker, table and file sections", () => {
  const report = buildCodegraphReport({
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "a9a43b844bc406a7db6266a338af8c1de09786fe",
    files: [{ path: "src/pricing.ts", status: "modified", additions: 12, deletions: 2 }],
    analyses: new Map([
      ["src/pricing.ts", analysis("src/pricing.ts", { symbols: [symbol("src/pricing.ts", "price")] })],
    ]),
    index: indexFixture(),
  });

  const body = buildCodegraphComment({ report, runId: "codebot-test", version: "0.1.0" });
  assert.ok(body.includes(CODEGRAPH_MARKER));
  assert.ok(body.includes("## CodeBot · Stage 1: codegraph"));
  assert.ok(body.includes("| [`src/pricing.ts`]("));
  assert.ok(body.includes("`src/cart.ts#total` calls `price`"));
  assert.ok(body.includes("src/pricing.test.ts"));
  assert.ok(body.includes("code index is at 3f7d3774"));
  assert.ok(body.includes("_Run `codebot-test`"));
});

test("reports an empty graph without throwing", () => {
  const report = buildCodegraphReport({
    repository: "acme/app",
    pullRequestNumber: 6,
    headSha: "abc",
    files: [],
    analyses: new Map(),
    index: null,
  });
  const body = buildCodegraphComment({ report, runId: "codebot-empty", version: "0.1.0" });
  assert.equal(report.totals.files, 0);
  assert.ok(body.includes("No analyzable source files changed in this diff."));
});
