import assert from "node:assert/strict";
import test from "node:test";
import {
  applyFilePatch,
  applyUnifiedDiff,
  joinLines,
  makeUnifiedDiff,
  parseUnifiedDiff,
  splitLines,
} from "../../src/util/diff";

test("makeUnifiedDiff returns empty string when contents match", () => {
  assert.equal(makeUnifiedDiff("a.ts", "one\ntwo\n", "one\ntwo\n"), "");
});

test("makeUnifiedDiff produces a valid single-hunk patch", () => {
  const patch = makeUnifiedDiff("src/a.ts", "const a = 1;\nconst b = 2;\n", "const a = 1;\nconst b = 3;\n");
  assert.match(patch, /^--- a\/src\/a\.ts\n\+\+\+ b\/src\/a\.ts\n/m);
  assert.match(patch, /-const b = 2;/);
  assert.match(patch, /\+const b = 3;/);
});

test("patch round trip preserves content", () => {
  const oldContent = "line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\n";
  const newContent = "line1\nline2 changed\nline3\nline4\nline5\nline6\nline7\nline8\n";
  const patch = makeUnifiedDiff("f.ts", oldContent, newContent);
  const parsed = parseUnifiedDiff(patch);
  assert.equal(parsed.length, 1);
  const applied = applyFilePatch(oldContent, parsed[0]);
  assert.equal(applied.ok, true);
  assert.equal(applied.content, newContent);
});

test("patch round trip handles multiple distant hunks", () => {
  const oldLines = Array.from({ length: 60 }, (_, index) => `line ${index}`);
  const newLines = [...oldLines];
  newLines[5] = "changed five";
  newLines[45] = "changed forty five";
  const oldContent = oldLines.join("\n") + "\n";
  const newContent = newLines.join("\n") + "\n";
  const patch = makeUnifiedDiff("f.ts", oldContent, newContent);
  const parsed = parseUnifiedDiff(patch);
  assert.equal(parsed[0].hunks.length, 2);
  const applied = applyFilePatch(oldContent, parsed[0]);
  assert.equal(applied.ok, true);
  assert.equal(applied.content, newContent);
});

test("patch round trip handles additions at the start and end", () => {
  const oldContent = "middle\n";
  const newContent = "first\nmiddle\nlast\n";
  const patch = makeUnifiedDiff("f.ts", oldContent, newContent);
  const applied = applyUnifiedDiff(patch, { "f.ts": oldContent });
  assert.equal(applied.ok, true);
  assert.equal(applied.files[0].applied, true);
});

test("patch round trip handles deletions", () => {
  const oldContent = "keep\ndrop\nkeep2\n";
  const newContent = "keep\nkeep2\n";
  const patch = makeUnifiedDiff("f.ts", oldContent, newContent);
  const applied = applyUnifiedDiff(patch, { "f.ts": oldContent });
  assert.equal(applied.ok, true);
});

test("patch round trip works without a trailing newline", () => {
  const oldContent = "a\nb";
  const newContent = "a\nc";
  const patch = makeUnifiedDiff("f.ts", oldContent, newContent);
  const applied = applyUnifiedDiff(patch, { "f.ts": oldContent });
  assert.equal(applied.ok, true);
});

test("applyUnifiedDiff reports a missing file", () => {
  const patch = makeUnifiedDiff("missing.ts", "a\n", "b\n");
  const applied = applyUnifiedDiff(patch, {});
  assert.equal(applied.ok, false);
  assert.equal(applied.files[0].applied, false);
  assert.equal(applied.files[0].reason, "file not found");
});

test("applyUnifiedDiff with requireAllFiles stops on missing file", () => {
  const patch = makeUnifiedDiff("missing.ts", "a\n", "b\n");
  const applied = applyUnifiedDiff(patch, {}, { requireAllFiles: true });
  assert.equal(applied.ok, false);
  assert.match(applied.reason ?? "", /file not found/);
});

test("applyFilePatch fails when context does not match", () => {
  const patch = makeUnifiedDiff("f.ts", "a\nb\n", "a\nc\n");
  const parsed = parseUnifiedDiff(patch);
  const applied = applyFilePatch("totally\ndifferent\n", parsed[0]);
  assert.equal(applied.ok, false);
  assert.match(applied.reason ?? "", /could not be located/);
});

test("applyFilePatch can locate a hunk shifted by earlier insertions", () => {
  const patch = makeUnifiedDiff("f.ts", "a\nb\nc\n", "a\nB\nc\n");
  const parsed = parseUnifiedDiff(patch);
  const applied = applyFilePatch("inserted\na\nb\nc\n", parsed[0]);
  assert.equal(applied.ok, true);
  assert.equal(applied.content, "inserted\na\nB\nc\n");
});

test("parseUnifiedDiff ignores trailing newline artifacts", () => {
  const patch = "--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@\n-a\n+b\n";
  const parsed = parseUnifiedDiff(patch);
  assert.equal(parsed[0].hunks[0].lines.length, 2);
});

test("parseUnifiedDiff handles empty patches", () => {
  assert.deepEqual(parseUnifiedDiff(""), []);
});

test("applyUnifiedDiff returns an error for an empty patch", () => {
  const result = applyUnifiedDiff("", {});
  assert.equal(result.ok, false);
  assert.match(result.reason ?? "", /no file patches/);
});

test("splitLines and joinLines round trip", () => {
  assert.deepEqual(splitLines("a\nb\n"), { lines: ["a", "b"], trailingNewline: true });
  assert.deepEqual(splitLines("a\nb"), { lines: ["a", "b"], trailingNewline: false });
  assert.deepEqual(splitLines(""), { lines: [], trailingNewline: false });
  assert.equal(joinLines(["a", "b"], true), "a\nb\n");
  assert.equal(joinLines(["a", "b"], false), "a\nb");
  assert.equal(joinLines([], true), "");
});

test("applyUnifiedDiff handles multiple files in one patch", () => {
  const patch =
    makeUnifiedDiff("a.ts", "const a = 1;\n", "const a = 2;\n") +
    makeUnifiedDiff("b.ts", "const b = 1;\n", "const b = 2;\n");
  const applied = applyUnifiedDiff(patch, { "a.ts": "const a = 1;\n", "b.ts": "const b = 1;\n" });
  assert.equal(applied.ok, true);
  assert.equal(applied.files.length, 2);
});

test("makeUnifiedDiff round trips across generated contents", () => {
  for (let seed = 0; seed < 40; seed++) {
    const lineCount = 5 + (seed % 25);
    const oldLines = Array.from({ length: lineCount }, (_, index) => `line ${index} seed ${seed}`);
    const newLines = oldLines.map((line, index) =>
      (index + seed) % 4 === 0 ? `${line} mutated` : line,
    );
    if (seed % 3 === 0) newLines.push(`appended ${seed}`);
    if (seed % 5 === 0) newLines.splice(2, 1);
    const oldContent = oldLines.join("\n") + "\n";
    const newContent = newLines.join("\n") + "\n";
    const patch = makeUnifiedDiff(`seed-${seed}.ts`, oldContent, newContent);
    const applied = applyUnifiedDiff(patch, { [`seed-${seed}.ts`]: oldContent });
    assert.equal(applied.ok, true, `seed ${seed} failed: ${applied.reason}`);
  }
});

test("makeUnifiedDiff handles large rewrites without LCS blowup", () => {
  const oldContent = Array.from({ length: 2000 }, (_, index) => `old ${index}`).join("\n") + "\n";
  const newContent = Array.from({ length: 2000 }, (_, index) => `new ${index}`).join("\n") + "\n";
  const patch = makeUnifiedDiff("big.ts", oldContent, newContent);
  const applied = applyUnifiedDiff(patch, { "big.ts": oldContent });
  assert.equal(applied.ok, true);
});
