import type { RepairEdit } from "./types";
import { isTestPath } from "./patch";

const BLOCKED_PATH_RE = /(^|\/)(\.github\/workflows\/|\.env|\.env\.[^/]+|node_modules\/|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)/i;

export interface SafetyAssessment {
  ok: boolean;
  reason: string;
}

export function assessEdits(edits: RepairEdit[]): SafetyAssessment {
  for (const edit of edits) {
    if (BLOCKED_PATH_RE.test(edit.path) || edit.path.startsWith(".github/")) {
      return { ok: false, reason: `${edit.path} is a restricted path` };
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
