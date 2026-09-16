import type { RepairEdit } from "./types";
import { isTestPath } from "./patch";

const BLOCKED_PATH_RE = /(^|\/)(\.github\/workflows\/|\.env|\.env\.[^/]+|node_modules\/|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)/i;
/** Dependency manifests are refused unless a future opt-in grants them. */
const MANIFEST_PATH_RE = /(^|\/)package\.json$/i;
const SUPPRESSION_RE = /@ts-ignore|@ts-expect-error|eslint-disable(?:-next-line|-line)?|\bas\s+any\b/;

const MAX_EDITS_PER_CALL = 12;
const MAX_EDIT_LINES = 200;
const MAX_TOTAL_LINES = 400;

function lineCount(text: string): number {
  if (text === "") return 0;
  return text.split("\n").length;
}

export interface SafetyAssessment {
  ok: boolean;
  reason: string;
}

export function assessEdits(edits: RepairEdit[]): SafetyAssessment {
  if (edits.length === 0) return { ok: false, reason: "no edits supplied" };
  if (edits.length > MAX_EDITS_PER_CALL) {
    return { ok: false, reason: `${edits.length} edits in one call exceeds the ${MAX_EDITS_PER_CALL}-edit limit` };
  }
  let totalLines = 0;
  for (const edit of edits) {
    if (BLOCKED_PATH_RE.test(edit.path) || edit.path.startsWith(".github/") || MANIFEST_PATH_RE.test(edit.path)) {
      return { ok: false, reason: `${edit.path} is a restricted path` };
    }
    const removed = lineCount(edit.find);
    const added = lineCount(edit.replace);
    for (const [label, count] of [["find", removed], ["replace", added]] as const) {
      if (count > MAX_EDIT_LINES) {
        return { ok: false, reason: `${edit.path} ${label} block is ${count} lines (limit ${MAX_EDIT_LINES})` };
      }
    }
    totalLines += removed + added;
    if (totalLines > MAX_TOTAL_LINES) {
      return { ok: false, reason: `this edit set changes ${totalLines} lines (limit ${MAX_TOTAL_LINES})` };
    }
    if (!SUPPRESSION_RE.test(edit.find.replace(/\r\n/g, "\n")) && SUPPRESSION_RE.test(edit.replace)) {
      return { ok: false, reason: `${edit.path} introduces a type/lint suppression or "as any"` };
    }
    if (isTestPath(edit.path)) {
      const removedAssertions = (edit.find.match(/expect\s*\(|assert[.(]/g) ?? []).length;
      const keptAssertions = (edit.replace.match(/expect\s*\(|assert[.(]/g) ?? []).length;
      if (removedAssertions > keptAssertions) {
        return { ok: false, reason: `${edit.path} weakens or removes test assertions` };
      }
    }
    if (/drop\s+table|truncate\s+table/i.test(edit.replace)) {
      return { ok: false, reason: "edit contains destructive SQL" };
    }
  }
  return { ok: true, reason: "" };
}
