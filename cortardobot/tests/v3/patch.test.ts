import assert from "node:assert/strict";
import { test } from "node:test";
import { locateEdit, unifiedDiffFromEdits } from "../../src/v3/patch.ts";
import { patchHasHunks } from "../../src/v3/result.ts";

const CONTENT = ['const a = 1;', 'const undefinedValue = undefined as any;', 'console.log(undefinedValue.property);', '', '  return ('].join("\n");

test("locateEdit finds edits with and without trailing newlines", () => {
  const plain = locateEdit(CONTENT, { find: "console.log(undefinedValue.property);", replace: "" });
  assert.equal(plain?.startLine, 3);

  const trailing = locateEdit(CONTENT, { find: "console.log(undefinedValue.property);\n", replace: "" });
  assert.equal(trailing?.startLine, 3);

  const multi = locateEdit(CONTENT, {
    find: "const undefinedValue = undefined as any;\nconsole.log(undefinedValue.property);\n\n  return (",
    replace: "  return (",
  });
  assert.equal(multi?.startLine, 2);
  assert.equal(multi?.endLine, 5);
});

test("unifiedDiffFromEdits renders multi-line replacements with hunks", () => {
  const patch = unifiedDiffFromEdits("src/a.ts", CONTENT, [
    {
      find: "const undefinedValue = undefined as any;\nconsole.log(undefinedValue.property);\n\n  return (",
      replace: "  return (",
    },
  ]);
  assert.ok(patchHasHunks(patch));
  assert.match(patch, /@@ -2,4 \+2,1 @@/);
  assert.match(patch, /-const undefinedValue = undefined as any;/);
  assert.match(patch, /\+  return \(/);
});

test("trailing-newline edits produce a hunk (the PR6 regression)", () => {
  const patch = unifiedDiffFromEdits("src/a.ts", CONTENT, [{ find: "console.log(undefinedValue.property);\n", replace: "// removed\n" }]);
  assert.ok(patchHasHunks(patch), patch);
  assert.match(patch, /-console\.log\(undefinedValue\.property\);/);
});

test("missing find text yields no hunks", () => {
  const patch = unifiedDiffFromEdits("src/a.ts", CONTENT, [{ find: "not in file", replace: "x" }]);
  assert.equal(patchHasHunks(patch), false);
});
