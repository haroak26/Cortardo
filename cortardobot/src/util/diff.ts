export interface PatchLine {
  type: " " | "-" | "+";
  text: string;
}

export interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: PatchLine[];
}

export interface FilePatch {
  oldPath: string;
  newPath: string;
  path: string;
  hunks: PatchHunk[];
}

export interface ApplyFileResult {
  ok: boolean;
  content?: string;
  reason?: string;
  hunksApplied: number;
  hunksTotal: number;
}

export interface PatchFileResult {
  path: string;
  applied: boolean;
  reason?: string;
  hunksApplied: number;
  hunksTotal: number;
}

export interface PatchApplyResult {
  ok: boolean;
  files: PatchFileResult[];
  reason?: string;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(patch: string): FilePatch[] {
  const lines = patch.split("\n");
  const files: FilePatch[] = [];
  let current: FilePatch | null = null;
  let hunk: PatchHunk | null = null;

  const pushHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("--- ")) {
      pushHunk();
      const oldPath = stripPathPrefix(line.slice(4));
      const next = lines[i + 1];
      if (next && next.startsWith("+++ ")) {
        const newPath = stripPathPrefix(next.slice(4));
        current = {
          oldPath,
          newPath,
          path: newPath === "/dev/null" ? oldPath : newPath,
          hunks: [],
        };
        files.push(current);
        i++;
      }
      continue;
    }
    if (!current) continue;
    const header = HUNK_HEADER.exec(line);
    if (header) {
      pushHunk();
      hunk = {
        oldStart: Number(header[1]),
        oldCount: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newCount: header[4] === undefined ? 1 : Number(header[4]),
        lines: [],
      };
      continue;
    }
    if (!hunk) continue;
    if (line.startsWith("\\")) continue;
    if (line.length === 0) continue;
    const marker = line[0];
    if (marker === " " || marker === "-" || marker === "+") {
      hunk.lines.push({ type: marker, text: line.slice(1) });
    }
  }
  pushHunk();
  return files.filter((file) => file.hunks.length > 0 || file.oldPath !== "/dev/null");
}

function stripPathPrefix(path: string): string {
  let value = path.trim();
  if (value.includes("\t")) value = value.split("\t")[0];
  if (value === "/dev/null") return value;
  if (value.startsWith("a/") || value.startsWith("b/")) value = value.slice(2);
  return value;
}

export function splitLines(content: string): { lines: string[]; trailingNewline: boolean } {
  if (content === "") return { lines: [], trailingNewline: false };
  const trailingNewline = content.endsWith("\n");
  const body = trailingNewline ? content.slice(0, -1) : content;
  return { lines: body.split("\n"), trailingNewline };
}

export function joinLines(lines: string[], trailingNewline: boolean): string {
  if (lines.length === 0) return "";
  return lines.join("\n") + (trailingNewline ? "\n" : "");
}

export function applyFilePatch(content: string, filePatch: FilePatch): ApplyFileResult {
  if (filePatch.hunks.length === 0) {
    return {
      ok: false,
      reason: "patch contains no hunks",
      hunksApplied: 0,
      hunksTotal: 0,
    };
  }
  const { lines, trailingNewline } = splitLines(content);
  const result: string[] = [];
  let source = 0;
  let hunksApplied = 0;
  let delta = 0;

  for (const hunk of filePatch.hunks) {
    const expected: string[] = [];
    const replacement: string[] = [];
    for (const patchLine of hunk.lines) {
      if (patchLine.type === " " || patchLine.type === "-") expected.push(patchLine.text);
      if (patchLine.type === " " || patchLine.type === "+") replacement.push(patchLine.text);
    }

    const preferred = hunk.oldStart - 1 + delta;
    const matchIndex = findBlock(lines, expected, preferred, source);
    if (matchIndex === -1) {
      return {
        ok: false,
        reason: `hunk at old line ${hunk.oldStart} could not be located`,
        hunksApplied,
        hunksTotal: filePatch.hunks.length,
      };
    }
    for (let i = source; i < matchIndex; i++) result.push(lines[i]);
    for (const line of replacement) result.push(line);
    source = matchIndex + expected.length;
    delta += replacement.length - expected.length;
    hunksApplied++;
  }
  for (let i = source; i < lines.length; i++) result.push(lines[i]);

  return {
    ok: true,
    content: joinLines(result, result.length > 0 && lines.length === 0 ? true : trailingNewline),
    hunksApplied,
    hunksTotal: filePatch.hunks.length,
  };
}

function findBlock(lines: string[], block: string[], preferred: number, minIndex: number): number {
  if (block.length === 0) return Math.max(minIndex, Math.min(preferred, lines.length));
  const bounded = Math.max(minIndex, preferred);
  if (matchesAt(lines, block, bounded)) return bounded;
  const fuzz = 500;
  for (let offset = 1; offset <= fuzz; offset++) {
    if (matchesAt(lines, block, bounded - offset) && bounded - offset >= minIndex) return bounded - offset;
    if (matchesAt(lines, block, bounded + offset)) return bounded + offset;
  }
  for (let i = minIndex; i <= lines.length - block.length; i++) {
    if (matchesAt(lines, block, i)) return i;
  }
  return -1;
}

function matchesAt(lines: string[], block: string[], index: number): boolean {
  if (index < 0 || index + block.length > lines.length) return false;
  for (let i = 0; i < block.length; i++) {
    if (lines[index + i] !== block[i]) return false;
  }
  return true;
}

export function applyUnifiedDiff(
  patch: string,
  files: Record<string, string>,
  options: { requireAllFiles?: boolean } = {},
): PatchApplyResult {
  const parsed = parseUnifiedDiff(patch);
  if (parsed.length === 0) {
    return { ok: false, files: [], reason: "no file patches found in diff" };
  }
  const results: PatchFileResult[] = [];
  for (const filePatch of parsed) {
    const isNewFile = filePatch.oldPath === "/dev/null";
    const isDeletedFile = filePatch.newPath === "/dev/null";
    const existing = files[filePatch.path] ?? files[filePatch.newPath] ?? files[filePatch.oldPath];
    const content = existing === undefined && isNewFile ? "" : existing;
    if (content === undefined) {
      results.push({
        path: filePatch.path,
        applied: false,
        reason: "file not found",
        hunksApplied: 0,
        hunksTotal: filePatch.hunks.length,
      });
      if (options.requireAllFiles) {
        return { ok: false, files: results, reason: `file not found: ${filePatch.path}` };
      }
      continue;
    }
    const applied = applyFilePatch(content, filePatch);
    if (applied.ok && applied.content !== undefined) {
      if (isDeletedFile) delete files[filePatch.path];
      else files[filePatch.path] = applied.content;
      results.push({
        path: filePatch.path,
        applied: true,
        hunksApplied: applied.hunksApplied,
        hunksTotal: applied.hunksTotal,
      });
    } else {
      results.push({
        path: filePatch.path,
        applied: false,
        reason: applied.reason,
        hunksApplied: applied.hunksApplied,
        hunksTotal: applied.hunksTotal,
      });
    }
  }
  const ok = results.length > 0 && results.every((file) => file.applied);
  return { ok, files: results, reason: ok ? undefined : "one or more files failed to apply" };
}

export function makeUnifiedDiff(
  path: string,
  oldContent: string,
  newContent: string,
  contextLines = 3,
): string {
  if (oldContent === newContent) return "";
  const oldSplit = splitLines(oldContent);
  const newSplit = splitLines(newContent);
  const ops = diffLines(oldSplit.lines, newSplit.lines);
  const hunks = buildHunks(ops, contextLines);

  const out: string[] = [];
  out.push(`--- a/${path}`);
  out.push(`+++ b/${path}`);
  for (const hunk of hunks) {
    out.push(formatHunkHeader(hunk));
    for (const op of hunk.ops) {
      if (op.type === " ") out.push(` ${op.text}`);
      else if (op.type === "-") out.push(`-${op.text}`);
      else out.push(`+${op.text}`);
    }
  }
  return out.join("\n") + "\n";
}

interface DiffOp {
  type: " " | "-" | "+";
  text: string;
}

function diffLines(oldLines: string[], newLines: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let prefix = 0;
  const maxPrefix = Math.min(oldLines.length, newLines.length);
  while (prefix < maxPrefix && oldLines[prefix] === newLines[prefix]) prefix++;
  let suffix = 0;
  const maxSuffix = Math.min(oldLines.length, newLines.length) - prefix;
  while (
    suffix < maxSuffix &&
    oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]
  ) {
    suffix++;
  }

  for (let i = 0; i < prefix; i++) ops.push({ type: " ", text: oldLines[i] });

  const oldMiddle = oldLines.slice(prefix, oldLines.length - suffix);
  const newMiddle = newLines.slice(prefix, newLines.length - suffix);
  ops.push(...diffMiddle(oldMiddle, newMiddle));

  for (let i = oldLines.length - suffix; i < oldLines.length; i++) {
    ops.push({ type: " ", text: oldLines[i] });
  }
  return ops;
}

const LCS_LIMIT = 1200;

function diffMiddle(oldMiddle: string[], newMiddle: string[]): DiffOp[] {
  if (oldMiddle.length === 0) return newMiddle.map((text) => ({ type: "+" as const, text }));
  if (newMiddle.length === 0) return oldMiddle.map((text) => ({ type: "-" as const, text }));
  if (oldMiddle.length > LCS_LIMIT || newMiddle.length > LCS_LIMIT) {
    return [
      ...oldMiddle.map((text) => ({ type: "-" as const, text })),
      ...newMiddle.map((text) => ({ type: "+" as const, text })),
    ];
  }

  const rows = oldMiddle.length + 1;
  const cols = newMiddle.length + 1;
  const table: Uint32Array = new Uint32Array(rows * cols);
  for (let i = oldMiddle.length - 1; i >= 0; i--) {
    for (let j = newMiddle.length - 1; j >= 0; j--) {
      const index = i * cols + j;
      if (oldMiddle[i] === newMiddle[j]) {
        table[index] = table[(i + 1) * cols + (j + 1)] + 1;
      } else {
        table[index] = Math.max(table[(i + 1) * cols + j], table[i * cols + (j + 1)]);
      }
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < oldMiddle.length && j < newMiddle.length) {
    if (oldMiddle[i] === newMiddle[j]) {
      ops.push({ type: " ", text: oldMiddle[i] });
      i++;
      j++;
    } else if (table[(i + 1) * cols + j] >= table[i * cols + (j + 1)]) {
      ops.push({ type: "-", text: oldMiddle[i] });
      i++;
    } else {
      ops.push({ type: "+", text: newMiddle[j] });
      j++;
    }
  }
  while (i < oldMiddle.length) ops.push({ type: "-", text: oldMiddle[i++] });
  while (j < newMiddle.length) ops.push({ type: "+", text: newMiddle[j++] });
  return ops;
}

interface Hunk {
  oldStart: number;
  newStart: number;
  oldCount: number;
  newCount: number;
  ops: DiffOp[];
}

function buildHunks(ops: DiffOp[], contextLines: number): Hunk[] {
  const changeIndexes: number[] = [];
  ops.forEach((op, index) => {
    if (op.type !== " ") changeIndexes.push(index);
  });
  if (changeIndexes.length === 0) return [];

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changeIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(ops.length - 1, index + contextLines);
    const last = ranges[ranges.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else ranges.push({ start, end });
  }

  const hunks: Hunk[] = [];
  for (const range of ranges) {
    const slice = ops.slice(range.start, range.end + 1);
    let oldStart = 1;
    let newStart = 1;
    for (let i = 0; i < range.start; i++) {
      if (ops[i].type !== "+") oldStart++;
      if (ops[i].type !== "-") newStart++;
    }
    let oldCount = 0;
    let newCount = 0;
    for (const op of slice) {
      if (op.type !== "+") oldCount++;
      if (op.type !== "-") newCount++;
    }
    hunks.push({ oldStart, newStart, oldCount, newCount, ops: slice });
  }
  return hunks;
}

function formatHunkHeader(hunk: Hunk): string {
  const oldPart = hunk.oldCount === 1 ? `${hunk.oldStart}` : `${hunk.oldStart},${hunk.oldCount}`;
  const newPart = hunk.newCount === 1 ? `${hunk.newStart}` : `${hunk.newStart},${hunk.newCount}`;
  return `@@ -${oldPart} +${newPart} @@`;
}
