import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MODELS, MODEL_CATALOG, resolveModelIds, resolveReasoning } from "../../../shared/models";
import { publicModelSelection, resolveEngineConfig } from "../../src/config";

test("model ids resolve canonical env, then legacy names, then role defaults", () => {
  assert.equal(
    resolveModelIds({ env: { CORTADO_MODEL_INVESTIGATOR: "openai/canonical", CORTADO_MODEL_LUNA: "openai/legacy" } }).investigator,
    "openai/canonical",
  );
  assert.equal(resolveModelIds({ env: { CORTADO_MODEL_LUNA: "openai/legacy" } }).investigator, "openai/legacy");
  assert.equal(resolveModelIds({ env: {} }).engineer, DEFAULT_MODELS.engineer);
  assert.equal(resolveModelIds({ env: {} }).reviewer, DEFAULT_MODELS.reviewer);
});

test("reasoning resolves canonical env, then legacy names, then role defaults", () => {
  assert.equal(resolveReasoning({ env: { CORTADO_REASONING_ENGINEER: "low" } }).engineer, "low");
  assert.equal(resolveReasoning({ env: { CORTADO_REASONING_CODEGEN: "minimal" } }).engineer, "minimal");
  assert.equal(resolveReasoning({ env: {} }).engineer, "high");
  assert.equal(resolveReasoning({ env: {} }).investigator, "medium");
});

test("the catalog only uses the three plain roles", () => {
  const roles = new Set(MODEL_CATALOG.map((entry) => entry.role));
  assert.deepEqual([...roles].sort(), ["engineer", "investigator", "reviewer"]);
});

test("the public model projection never carries the gateway key or base URL", () => {
  const config = resolveEngineConfig({ models: { apiKey: "mg_secret_value", baseUrl: "https://internal.example" } });
  const projected = publicModelSelection(config.models);
  const serialized = JSON.stringify(projected);
  assert.equal(/"apiKey"|"baseUrl"|mg_/.test(serialized), false);
  assert.ok(projected.investigator.length > 0);
});
