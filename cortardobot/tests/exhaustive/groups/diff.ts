import assert from "node:assert/strict";
import { applyUnifiedDiff, makeUnifiedDiff, parseUnifiedDiff } from "../../../src/util/diff";
import { mulberry32, randomInt, randomLines } from "../prng";
import { defineCases } from "../types";

interface ContentPair {
  oldContent: string;
  newContent: string;
}

function join(lines: string[], trailingNewline: boolean, eol = "\n"): string {
  if (lines.length === 0) return "";
  return lines.join(eol) + (trailingNewline ? eol : "");
}

function generatePair(seed: number): ContentPair {
  const rand = mulberry32(seed * 7919 + 17);
  const variant = seed % 12;
  const eol = variant === 5 ? "\r\n" : "\n";
  const trailing = variant !== 6;
  const alphabet = variant === 7 ? "αβγδε日本語 ٠١٢" : undefined;

  if (variant === 0) {
    return { oldContent: "", newContent: join(randomLines(rand, randomInt(rand, 1, 10)), trailing, eol) };
  }
  if (variant === 1) {
    return { oldContent: join(randomLines(rand, randomInt(rand, 1, 10)), trailing, eol), newContent: "" };
  }
  if (variant === 2) {
    const lines = randomLines(rand, randomInt(rand, 2, 8), "same");
    const content = join(lines, trailing, eol);
    return { oldContent: content, newContent: content };
  }

  const oldLines = randomLines(rand, randomInt(rand, 5, 60), alphabet ? "unicode" : "source");
  const newLines = [...oldLines];
  const operations = randomInt(rand, 1, 4);
  for (let index = 0; index < operations; index++) {
    if (newLines.length === 0) {
      newLines.push(`inserted ${seed} ${index}`);
      continue;
    }
    const position = randomInt(rand, 0, newLines.length - 1);
    const op = randomInt(rand, 0, 3);
    if (op === 0) newLines[position] = `mutated ${seed} ${index}`;
    else if (op === 1) newLines.splice(position, 0, `inserted ${seed} ${index}`);
    else if (op === 2) newLines.splice(position, 1);
    else newLines.splice(position, 2, `block a ${seed} ${index}`, `block b ${seed} ${index}`);
  }
  if (variant === 8) newLines.push(`appended ${seed}`);
  if (variant === 9) newLines.unshift(`prepended ${seed}`);
  return { oldContent: join(oldLines, trailing, eol), newContent: join(newLines, trailing, eol) };
}

function propertyCases() {
  return Array.from({ length: 40 }, (_, index) => {
    const seed = index + 1;
    return {
      name: `diff property round trip seed=${seed}`,
      run: () => {
        const { oldContent, newContent } = generatePair(seed);
        const path = `generated/file-${seed}.ts`;
        const patch = makeUnifiedDiff(path, oldContent, newContent);
        const repeated = makeUnifiedDiff(path, oldContent, newContent);
        assert.equal(patch, repeated, "makeUnifiedDiff must be deterministic");

        if (oldContent === newContent) {
          assert.equal(patch, "");
          return;
        }
        assert.ok(patch.startsWith(`--- a/${path}`), "patch must start with the old file header");
        assert.ok(patch.includes(`+++ b/${path}`), "patch must include the new file header");
        assert.ok(parseUnifiedDiff(patch).length >= 1, "patch must parse to at least one file");

        const files: Record<string, string> = { [path]: oldContent };
        const applied = applyUnifiedDiff(patch, files);
        assert.equal(applied.ok, true, applied.reason);
        assert.equal(files[path], newContent, "applied patch must reproduce the new content");
      },
    };
  });
}

function edgeCases() {
  return [
    {
      name: "apply fails cleanly for a missing file",
      run: () => {
        const patch = makeUnifiedDiff("missing.ts", "a\n", "b\n");
        const result = applyUnifiedDiff(patch, {});
        assert.equal(result.ok, false);
        assert.equal(result.files[0].reason, "file not found");
      },
    },
    {
      name: "multi-file patch applies the present file and reports the missing one",
      run: () => {
        const patch =
          makeUnifiedDiff("present.ts", "a\n", "b\n") + makeUnifiedDiff("absent.ts", "x\n", "y\n");
        const files: Record<string, string> = { "present.ts": "a\n" };
        const result = applyUnifiedDiff(patch, files);
        assert.equal(result.ok, false);
        assert.equal(files["present.ts"], "b\n");
        assert.equal(result.files.find((file) => file.path === "absent.ts")?.applied, false);
      },
    },
    {
      name: "requireAllFiles stops the batch on a missing file",
      run: () => {
        const patch = makeUnifiedDiff("absent.ts", "x\n", "y\n");
        const result = applyUnifiedDiff(patch, {}, { requireAllFiles: true });
        assert.equal(result.ok, false);
        assert.match(result.reason ?? "", /file not found/);
      },
    },
    {
      name: "hunks shifted by earlier insertions still apply",
      run: () => {
        const patch = makeUnifiedDiff("f.ts", "a\nb\nc\n", "a\nB\nc\n");
        const result = applyUnifiedDiff(patch, { "f.ts": "inserted\na\nb\nc\n" });
        assert.equal(result.ok, true);
        assert.equal(result.files[0].applied, true);
      },
    },
    {
      name: "empty patch is rejected",
      run: () => {
        const result = applyUnifiedDiff("", {});
        assert.equal(result.ok, false);
        assert.match(result.reason ?? "", /no file patches/);
      },
    },
    {
      name: "context-only patch applies without changing content",
      run: () => {
        const content = "one\ntwo\nthree\n";
        const patch = "--- a/f.ts\n+++ b/f.ts\n@@ -1,3 +1,3 @@\n one\n two\n three\n";
        const result = applyUnifiedDiff(patch, { "f.ts": content });
        assert.equal(result.ok, true);
        assert.equal(result.files[0].applied, true);
      },
    },
    {
      name: "no-newline markers are ignored",
      run: () => {
        const patch = "--- a/f.ts\n+++ b/f.ts\n@@ -1,1 +1,1 @@\n-a\n\\ No newline at end of file\n+b\n";
        const parsed = parseUnifiedDiff(patch);
        assert.equal(parsed[0].hunks[0].lines.length, 2);
        assert.equal(applyUnifiedDiff(patch, { "f.ts": "a" }).ok, true);
      },
    },
    {
      name: "malformed hunk headers produce no file patches",
      run: () => {
        const patch = "--- a/f.ts\n+++ b/f.ts\n@@ broken @@\n-a\n+b\n";
        const parsed = parseUnifiedDiff(patch);
        assert.equal(parsed[0].hunks.length, 0);
        assert.equal(applyUnifiedDiff(patch, { "f.ts": "a" }).ok, false);
      },
    },
    {
      name: "hunk count mismatches still apply by content matching",
      run: () => {
        const patch = "--- a/f.ts\n+++ b/f.ts\n@@ -1,99 +1,99 @@\n-a\n+b\n";
        const result = applyUnifiedDiff(patch, { "f.ts": "a\n" });
        assert.equal(result.ok, true);
      },
    },
    {
      name: "new file patch with /dev/null old path applies to empty content",
      run: () => {
        const patch = makeUnifiedDiff("new.ts", "", "hello\n");
        assert.equal(applyUnifiedDiff(patch, { "new.ts": "" }).ok, true);
      },
    },
    {
      name: "deletion patch removing all lines produces empty content",
      run: () => {
        const patch = makeUnifiedDiff("gone.ts", "a\nb\n", "");
        const files: Record<string, string> = { "gone.ts": "a\nb\n" };
        assert.equal(applyUnifiedDiff(patch, files).ok, true);
        assert.equal(files["gone.ts"], "");
      },
    },
    {
      name: "failed patches do not mutate the file record",
      run: () => {
        const patch = makeUnifiedDiff("f.ts", "a\n", "b\n");
        const files: Record<string, string> = { "f.ts": "unrelated\n" };
        const result = applyUnifiedDiff(patch, files);
        assert.equal(result.ok, false);
        assert.equal(files["f.ts"], "unrelated\n");
        assert.equal(result.files[0].applied, false);
      },
    },
  ];
}

export function buildDiffGroup() {
  return defineCases("diff", [...propertyCases(), ...edgeCases()]);
}
