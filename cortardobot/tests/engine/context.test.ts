import { test } from "node:test";
import assert from "node:assert/strict";
import { GraphIndex, extractStrings } from "../../src/context/graph";
import { BUGGY_BILLING, WORKSPACE_SOURCE, workflowGraph } from "./helpers";

test("impact finds callers, string consumers, importers and tests of a changed file", () => {
  const graph = new GraphIndex(workflowGraph());
  graph.overlay("src/billing.ts", BUGGY_BILLING);
  const impact = graph.impact(["src/billing.ts"], []);
  assert.ok(impact.changedSymbols.some((symbol) => symbol.name === "applyPlan"));
  assert.ok(impact.callers.some((ref) => ref.symbol.name === "readWorkspace"), "readWorkspace calls into the changed symbol");
  assert.ok(impact.importers.includes("src/workspace.ts"));
  assert.ok(impact.tests.includes("src/billing.test.ts"));
  assert.ok(
    impact.stringConsumers.some((consumer) => consumer.value === "ag.activeWorkspaceId"),
    "the storage key used by the diff is found elsewhere in the repository",
  );
});

test("search_strings answers who reads a key across the repository and the diff", () => {
  const graph = new GraphIndex(workflowGraph());
  graph.overlay("src/billing.ts", BUGGY_BILLING);
  const refs = graph.searchStrings("ag.activeWorkspaceId");
  assert.ok(refs.some((ref) => ref.path === "src/workspace.ts" && !ref.changed));
  assert.ok(refs.some((ref) => ref.path === "src/billing.ts" && ref.changed));
});

test("overlay string extraction ignores paths and prose", () => {
  const strings = extractStrings(WORKSPACE_SOURCE);
  assert.deepEqual(strings.map((entry) => entry.value), ["ag.activeWorkspaceId"]);
});

test("empty graph degrades to an empty impact slice instead of throwing", () => {
  const graph = new GraphIndex();
  const impact = graph.impact(["src/billing.ts"]);
  assert.equal(impact.callers.length, 0);
  assert.equal(impact.tests.length, 0);
});
