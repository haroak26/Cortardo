import type { DiffLine, Hunk, ParsedFile } from "./types";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const FILE_OLD_RE = /^--- (?:(?:a\/)?(.+?))(?:\t.*)?$/;
const FILE_NEW_RE = /^\+\+\+ (?:(?:b\/)?(.+?))(?:\t.*)?$/;
const DIFF_GIT_RE = /^diff --git a\/(.+?) b\/(.+)$/;

export interface FilePatch {
  path: string;
  previousPath?: string;
  oldPath?: string;
  newPath?: string;
  hunks: Hunk[];
}

/**
 * Parses unified diffs produced by git (`--- a/x`, `+++ b/x` headers) and the
 * bare-hunk patches GitHub returns per file (`@@ ... @@` only). This was the
 * defect that made the previous engine see zero additions on PRs.
 */
export function parseFilePatch(path: string, patch: string): FilePatch {
  const normalizedPath = path.replace(/^\/+/, "");
  const filePatch: FilePatch = { path: normalizedPath, oldPath: normalizedPath, newPath: normalizedPath, hunks: [] };
  if (!patch || !patch.trim()) return filePatch;

  const lines = patch.replace(/\r\n/g, "\n").split("\n");
  let hunk: Hunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const raw of lines) {
    const gitMatch = DIFF_GIT_RE.exec(raw);
    if (gitMatch) {
      filePatch.previousPath = gitMatch[1];
      filePatch.path = gitMatch[2];
      filePatch.oldPath = gitMatch[1];
      filePatch.newPath = gitMatch[2];
      hunk = null;
      continue;
    }
    const oldMatch = FILE_OLD_RE.exec(raw);
    if (oldMatch && raw.startsWith("--- ")) {
      const candidate = oldMatch[1].trim();
      if (candidate !== "/dev/null") filePatch.oldPath = candidate;
      else filePatch.oldPath = "/dev/null";
      hunk = null;
      continue;
    }
    const newMatch = FILE_NEW_RE.exec(raw);
    if (newMatch && raw.startsWith("+++ ")) {
      const candidate = newMatch[1].trim();
      if (candidate !== "/dev/null") {
        filePatch.newPath = candidate;
        if (candidate) filePatch.path = candidate;
      } else {
        filePatch.newPath = "/dev/null";
      }
      hunk = null;
      continue;
    }

    const hunkMatch = HUNK_RE.exec(raw);
    if (hunkMatch) {
      oldLine = Number(hunkMatch[1]);
      newLine = Number(hunkMatch[3]);
      hunk = {
        oldStart: oldLine,
        oldLines: hunkMatch[2] !== undefined ? Number(hunkMatch[2]) : 1,
        newStart: newLine,
        newLines: hunkMatch[4] !== undefined ? Number(hunkMatch[4]) : 1,
        header: (hunkMatch[5] ?? "").trim(),
        lines: [],
      };
      filePatch.hunks.push(hunk);
      continue;
    }

    if (!hunk) continue;

    if (raw.startsWith("\\")) {
      hunk.lines.push({ type: "\\", text: raw.slice(1).trim() });
      continue;
    }
    const marker = raw[0];
    const text = raw.length > 0 ? raw.slice(1) : "";
    if (marker === "+") {
      hunk.lines.push({ type: "+", text, newLine });
      newLine++;
    } else if (marker === "-") {
      hunk.lines.push({ type: "-", text, oldLine });
      oldLine++;
    } else if (marker === " " || raw === "") {
      hunk.lines.push({ type: " ", text, oldLine, newLine });
      oldLine++;
      newLine++;
    } else {
      hunk = null;
    }
  }

  return filePatch;
}

export function collectChangedLines(filePatch: FilePatch): { added: DiffLine[]; removed: DiffLine[] } {
  const added: DiffLine[] = [];
  const removed: DiffLine[] = [];
  for (const hunk of filePatch.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "+") added.push(line);
      else if (line.type === "-") removed.push(line);
    }
  }
  return { added, removed };
}

export function parseChangedFiles(files: Array<{ path: string; status?: string; patch?: string; content?: string; additions?: number; deletions?: number; previousPath?: string }>): ParsedFile[] {
  return files.map((input) => {
    const path = input.path.replace(/^\/+/, "");
    const filePatch = parseFilePatch(path, input.patch ?? "");
    const { added, removed } = collectChangedLines(filePatch);
    const content = input.content;
    const lines = content !== undefined ? content.replace(/\r\n/g, "\n").split("\n") : undefined;
    return {
      path,
      previousPath: input.previousPath,
      status: (input.status as ParsedFile["status"]) ?? "modified",
      language: detectLanguage(path),
      additions: input.additions ?? added.length,
      deletions: input.deletions ?? removed.length,
      hunks: filePatch.hunks,
      addedLines: added,
      removedLines: removed,
      content,
      lines,
    };
  });
}

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "TypeScript",
  tsx: "TypeScript",
  js: "JavaScript",
  jsx: "JavaScript",
  mjs: "JavaScript",
  cjs: "JavaScript",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  rs: "Rust",
  java: "Java",
  kt: "Kotlin",
  php: "PHP",
  cs: "C#",
  swift: "Swift",
  sql: "SQL",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  toml: "TOML",
  md: "Markdown",
  css: "CSS",
  scss: "CSS",
  html: "HTML",
  sh: "Shell",
};

export function detectLanguage(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGUAGE_BY_EXTENSION[ext] ?? "Unknown";
}

export function isTestPath(path: string): boolean {
  return /(\.(test|spec)\.[cm]?[jt]sx?$)|(__tests__\/)|((^|\/)(tests?|specs?)\/)/.test(path);
}

/** Lines that can carry a GitHub inline comment must be present in a hunk. */
export function lineInDiff(file: ParsedFile, line: number): boolean {
  for (const hunk of file.hunks) {
    for (const diffLine of hunk.lines) {
      if (diffLine.newLine === line && diffLine.type !== "-") return true;
    }
  }
  return false;
}

export function nearestAddedLine(file: ParsedFile, line: number, maxDistance = 6): number | undefined {
  let best: number | undefined;
  let bestDistance = Infinity;
  for (const added of file.addedLines) {
    if (added.newLine === undefined) continue;
    const distance = Math.abs(added.newLine - line);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = added.newLine;
    }
  }
  return bestDistance <= maxDistance ? best : undefined;
}

/** Renders changed hunks with real line numbers and surrounding context. */
export function renderCompactDiff(files: ParsedFile[], options: { maxChars?: number; contextLines?: number } = {}): string {
  const maxChars = options.maxChars ?? 24_000;
  const contextLines = options.contextLines ?? 10;
  const blocks: string[] = [];

  for (const file of files) {
    if (!file.content && file.hunks.length === 0) continue;
    const lines = file.lines ?? [];
    const changed = new Set<number>();
    if (file.lines) {
      for (const hunk of file.hunks) {
        for (const line of hunk.lines) {
          if (line.type === "+" && line.newLine !== undefined) changed.add(line.newLine);
          if (line.type === "-" && line.oldLine !== undefined) changed.add(line.oldLine);
        }
      }
      const range = new Set<number>();
      for (const lineNo of changed) {
        for (let i = lineNo - contextLines; i <= lineNo + contextLines; i++) range.add(i);
      }
      const sorted = [...range].filter((n) => n >= 1 && n <= lines.length).sort((a, b) => a - b);
      const body: string[] = [];
      let previous = 0;
      for (const lineNo of sorted) {
        if (lineNo !== previous + 1) body.push("      ...");
        const marker = changed.has(lineNo) ? ">" : " ";
        body.push(`${marker} ${String(lineNo).padStart(5)}| ${lines[lineNo - 1] ?? ""}`);
        previous = lineNo;
      }
      blocks.push(`### ${file.path} (${file.status}, +${file.additions}/-${file.deletions})\n${body.join("\n")}`);
    } else {
      const body = file.hunks.flatMap((hunk) =>
        hunk.lines.map((line) => {
          const marker = line.type === "+" ? "+" : line.type === "-" ? "-" : " ";
          const lineNo = line.newLine ?? line.oldLine ?? "";
          return `${marker} ${String(lineNo).padStart(5)}| ${line.text}`;
        }),
      );
      blocks.push(`### ${file.path} (${file.status}, +${file.additions}/-${file.deletions})\n${body.join("\n")}`);
    }
  }

  let out = blocks.join("\n\n");
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n... [diff truncated]`;
  return out;
}

export function renderNumberedFile(content: string, start = 1): string {
  return content
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line, index) => `${String(index + start).padStart(5)}| ${line}`)
    .join("\n");
}

export function findLineIndex(lines: string[], findLines: string[]): number {
  for (let i = 0; i + findLines.length <= lines.length; i++) {
    let match = true;
    for (let j = 0; j < findLines.length; j++) {
      if (lines[i + j] !== findLines[j]) {
        match = false;
        break;
      }
    }
    if (match) return i;
  }
  return -1;
}

export interface EditLocation {
  startLine: number;
  endLine: number;
  findLines: string[];
  replaceLines: string[];
}

/**
 * Locates an exact find/replace edit in file content, tolerating a trailing
 * newline on either side (models frequently include one). Line numbers are
 * 1-based and inclusive; endLine is the last line actually replaced.
 */
export function locateEdit(content: string, edit: { find: string; replace: string }): EditLocation | undefined {
  const normalizedContent = content.replace(/\r\n/g, "\n");
  const normalizedFind = edit.find.replace(/\r\n/g, "\n");
  const normalizedReplace = edit.replace.replace(/\r\n/g, "\n");
  let index = normalizedContent.indexOf(normalizedFind);
  let find = normalizedFind;
  let replace = normalizedReplace;
  if (index < 0) {
    const trimmedFind = normalizedFind.replace(/\n$/, "");
    index = normalizedContent.indexOf(trimmedFind);
    if (index < 0) return undefined;
    find = trimmedFind;
    replace = normalizedReplace.replace(/\n$/, "");
  }
  const before = normalizedContent.slice(0, index);
  const startLine = before.split("\n").length;
  const findLines = find.split("\n");
  const replaceLines = replace.split("\n");
  const endLine = startLine + findLines.length - 1;
  return { startLine, endLine, findLines, replaceLines };
}

export function unifiedDiffFromEdits(filePath: string, content: string, edits: Array<{ find: string; replace: string }>): string {
  const parts: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];
  for (const edit of edits) {
    const location = locateEdit(content, edit);
    if (!location) continue;
    parts.push(`@@ -${location.startLine},${location.findLines.length} +${location.startLine},${location.replaceLines.length} @@`);
    for (const line of location.findLines) parts.push(`-${line}`);
    for (const line of location.replaceLines) parts.push(`+${line}`);
  }
  return parts.join("\n");
}
