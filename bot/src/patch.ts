/**
 * Unified diff parsing for the hypothesis stage. GitHub sends a `patch` per
 * changed file; the rules need the exact added/removed lines with their new
 * file line numbers, and the master agent needs a compact diff to read.
 */
import type { CodegraphChangedFile } from "./types.ts";

export interface PatchLine {
  type: "+" | "-" | " ";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface ParsedHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: PatchLine[];
}

export interface ParsedPatch {
  path: string;
  hunks: ParsedHunk[];
  /** New-file line number -> added line text. */
  added: Map<number, string>;
  /** Removed lines with their old-file line numbers. */
  removed: Array<{ line: number; text: string }>;
  additions: number;
  deletions: number;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

function emptyPatch(path: string): ParsedPatch {
  return { path, hunks: [], added: new Map(), removed: [], additions: 0, deletions: 0 };
}

export function parsePatch(path: string, patch: string | undefined): ParsedPatch {
  if (!patch) return emptyPatch(path);
  const parsed = emptyPatch(path);
  let hunk: ParsedHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    const header = HUNK_HEADER.exec(raw);
    if (header) {
      oldLine = Number(header[1]);
      newLine = Number(header[2]);
      hunk = { header: raw, oldStart: oldLine, newStart: newLine, lines: [] };
      parsed.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;
    if (raw.startsWith("\\")) continue;

    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      hunk.lines.push({ type: "+", text, oldLine: null, newLine });
      parsed.added.set(newLine, text);
      parsed.additions += 1;
      newLine += 1;
    } else if (marker === "-") {
      hunk.lines.push({ type: "-", text, oldLine, newLine: null });
      parsed.removed.push({ line: oldLine, text });
      parsed.deletions += 1;
      oldLine += 1;
    } else if (marker === " ") {
      hunk.lines.push({ type: " ", text, oldLine, newLine });
      oldLine += 1;
      newLine += 1;
    }
  }
  return parsed;
}

export function parsePatches(files: CodegraphChangedFile[]): Map<string, ParsedPatch> {
  const patches = new Map<string, ParsedPatch>();
  for (const file of files) patches.set(file.path, parsePatch(file.path, file.patch));
  return patches;
}

/** Line-based draft patch rendering from exact find/replace pairs. */
export function renderFixDiff(edits: Array<{ path: string; find: string; replace: string }>, maxChars = 8_000): string {
  const blocks: string[] = [];
  for (const edit of edits) {
    const removed = edit.find.split("\n").map((line) => `-${line}`);
    const added = edit.replace.split("\n").map((line) => `+${line}`);
    blocks.push([`--- a/${edit.path}`, `+++ b/${edit.path}`, ...removed, ...added].join("\n"));
  }
  const body = blocks.join("\n");
  return body.length <= maxChars ? body : `${body.slice(0, maxChars - 1)}…`;
}

const MAX_HUNKS_PER_FILE = 8;
const MAX_CHARS_PER_FILE = 8_000;

/** Compact, line-numbered diff for the master agent (added lines marked `>`). */
export function renderChangedPatches(files: CodegraphChangedFile[], maxChars: number): string {
  const blocks: string[] = [];
  let used = 0;
  for (const file of files) {
    if (!file.patch) continue;
    const parsed = parsePatch(file.path, file.patch);
    if (parsed.hunks.length === 0) continue;
    const lines: string[] = [`### ${file.path} (${file.status}, +${file.additions}/-${file.deletions})`];
    for (const hunk of parsed.hunks.slice(0, MAX_HUNKS_PER_FILE)) {
      lines.push(hunk.header);
      for (const line of hunk.lines) {
        const gutter = line.type === "+" ? (line.newLine ?? "") : line.type === "-" ? (line.oldLine ?? "") : "";
        lines.push(`${line.type === "+" ? ">" : line.type} ${gutter}| ${line.text}`);
      }
    }
    let block = lines.join("\n");
    if (block.length > MAX_CHARS_PER_FILE) block = `${block.slice(0, MAX_CHARS_PER_FILE - 1)}…`;
    if (used + block.length > maxChars) {
      const remaining = maxChars - used;
      if (remaining < 200) break;
      block = `${block.slice(0, remaining - 1)}…`;
    }
    blocks.push(block);
    used += block.length + 1;
    if (used >= maxChars) break;
  }
  return blocks.join("\n\n");
}
