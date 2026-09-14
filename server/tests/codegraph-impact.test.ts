import assert from "node:assert/strict";
import test from "node:test";
import { analyzeSources } from "../lib/codegraph/analyze";
import { analyseImpact } from "../lib/codegraph/impact";

async function buildRepo() {
  return analyzeSources([
    { path: "src/util.ts", content: "export function helper(id: string) { return id; }\n" },
    {
      path: "src/app.ts",
      content: "import { helper } from './util';\nexport function run() { return helper('x'); }\n",
    },
    {
      path: "src/other.ts",
      content: "import { run } from './app';\nexport function boot() { return run(); }\n",
    },
    { path: "src/util.test.ts", content: "import { helper } from './util';\nhelper('t');\n" },
  ]);
}

test("analyseImpact finds transitive callers of changed symbols", async () => {
  const graph = await buildRepo();
  const impact = analyseImpact(
    {
      files: graph.files.map((file) => ({ id: file.id, path: file.path, kind: file.kind })),
      connections: graph.connections,
      symbols: graph.symbols,
      symbolEdges: graph.symbolEdges,
    },
    ["src/util.ts"],
  );

  const callerNames = impact.callers.map((caller) => `${caller.symbol.qualifiedName}@${caller.depth}`);
  assert.ok(callerNames.includes("run@1"), `expected direct caller run, got ${callerNames.join(", ")}`);
  assert.ok(callerNames.includes("boot@2"), `expected transitive caller boot, got ${callerNames.join(", ")}`);

  assert.ok(impact.tests.includes("src/util.test.ts"));
  assert.ok(impact.changedSymbols.some((symbol) => symbol.qualifiedName === "helper"));
});

test("analyseImpact returns no callers for an unreferenced file", async () => {
  const graph = await buildRepo();
  const impact = analyseImpact(
    {
      files: graph.files.map((file) => ({ id: file.id, path: file.path, kind: file.kind })),
      connections: graph.connections,
      symbols: graph.symbols,
      symbolEdges: graph.symbolEdges,
    },
    ["src/other.ts"],
  );

  assert.equal(impact.callers.length, 0);
});
