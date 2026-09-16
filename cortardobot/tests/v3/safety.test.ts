import assert from "node:assert/strict";
import { test } from "node:test";
import { assessEdits } from "../../src/v3/safety.ts";

const edit = (overrides: Partial<{ path: string; find: string; replace: string }> = {}) => ({
  path: overrides.path ?? "src/a.ts",
  find: overrides.find ?? "const a = 1;",
  replace: overrides.replace ?? "const a = 2;",
});

test("assessEdits accepts a normal root-cause edit", () => {
  assert.deepEqual(assessEdits([edit()]), { ok: true, reason: "" });
});

test("assessEdits blocks restricted paths and dependency manifests", () => {
  for (const path of [".github/workflows/ci.yml", ".env", "package-lock.json", "app/node_modules/x.ts", "package.json", "client/package.json"]) {
    const result = assessEdits([edit({ path })]);
    assert.equal(result.ok, false, `${path} must be rejected`);
  }
});

test("assessEdits rejects newly introduced suppressions but tolerates existing ones", () => {
  const introduced = assessEdits([edit({ find: "const a: Foo = value;", replace: "const a: Foo = value as any;" })]);
  assert.equal(introduced.ok, false);
  const tsIgnore = assessEdits([edit({ find: "run();", replace: "// @ts-ignore\nrun();" })]);
  assert.equal(tsIgnore.ok, false);
  const preexisting = assessEdits([edit({ find: "const a = value as any;", replace: "const a = value as any;\nconst b = 2;" })]);
  assert.equal(preexisting.ok, true);
});

test("assessEdits bounds the size of a single call", () => {
  const many = Array.from({ length: 13 }, (_, index) => edit({ find: `const a${index} = 1;`, replace: `const a${index} = 2;` }));
  assert.equal(assessEdits(many).ok, false);
  const huge = assessEdits([edit({ find: "x", replace: Array.from({ length: 201 }, () => "line").join("\n") })]);
  assert.equal(huge.ok, false);
  assert.equal(assessEdits([]).ok, false);
});

test("assessEdits still blocks assertion weakening and destructive SQL", () => {
  const weakened = assessEdits([edit({ path: "src/a.test.ts", find: "expect(a).toBe(1);", replace: "const a = 1;" })]);
  assert.equal(weakened.ok, false);
  const sql = assessEdits([edit({ replace: "DROP TABLE users;" })]);
  assert.equal(sql.ok, false);
});
