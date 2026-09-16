import type { Finding } from "../../../cortardobot/src/types.ts";
import * as github from "../github/api";

const DEFAULT_MAX_FINDINGS = 3;

interface ProtectedPathRule {
  label: string;
  test: RegExp;
}

/** Paths the bot must never auto-commit, even for a verified fix. */
const PROTECTED_PATHS: ProtectedPathRule[] = [
  {
    label: "lockfile",
    test: /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|composer\.lock|go\.sum|packages\.lock\.json|mix\.lock)$/i,
  },
  { label: "test", test: /(^|\/)(__tests__|tests?|specs?)\//i },
  { label: "test", test: /\.(test|spec)\.[^/]+$/i },
  { label: "test", test: /(^|\/)test_[^/]+\.py$/i },
  { label: "test", test: /_test\.(go|py|rb|exs)$/i },
  { label: "workflow", test: /^\.github\//i },
  { label: "environment", test: /(^|\/)\.env(\.|$)/i },
  { label: "environment", test: /(^|\/)\.(envrc|npmrc)$/i },
  { label: "secret", test: /(^|\/)(secrets?|credentials?)(\.[^/]+)?$/i },
  { label: "secret", test: /(^|\/)(id_rsa|id_ed25519|id_ecdsa)/i },
  { label: "secret", test: /\.(pem|key|p12|pfx|keystore|jks)$/i },
  { label: "vendored", test: /(^|\/)(node_modules|vendor|third_party)\//i },
];

/** Literal-looking secrets that must never reach a commit, even in a fix. */
const SECRET_PATTERNS: RegExp[] = [
  /gh[pousr]_[A-Za-z0-9]{20,}/,
  /github_pat_[A-Za-z0-9_]{20,}/,
  /AKIA[0-9A-Z]{16}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /sk-[A-Za-z0-9]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /(api[_-]?key|secret|token|password)\s*[:=]\s*["'][^"']{8,}["']/i,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

export function protectedPathReason(path: string): string | undefined {
  return PROTECTED_PATHS.find((rule) => rule.test.test(path))?.label;
}

export interface AutoCommitDeps {
  getInstallationPermissions: typeof github.getInstallationPermissions;
  getBranchHead: typeof github.getBranchHead;
  getCommitMessage: typeof github.getCommitMessage;
  getCommitTreeSha: typeof github.getCommitTreeSha;
  getFileWithSha: typeof github.getFileWithSha;
  createBlob: typeof github.createBlob;
  createTreeWithChanges: typeof github.createTreeWithChanges;
  createCommit: typeof github.createCommit;
  updateRef: typeof github.updateRef;
}

export const defaultAutoCommitDeps: AutoCommitDeps = {
  getInstallationPermissions: github.getInstallationPermissions,
  getBranchHead: github.getBranchHead,
  getCommitMessage: github.getCommitMessage,
  getCommitTreeSha: github.getCommitTreeSha,
  getFileWithSha: github.getFileWithSha,
  createBlob: github.createBlob,
  createTreeWithChanges: github.createTreeWithChanges,
  createCommit: github.createCommit,
  updateRef: github.updateRef,
};

export interface AutoCommitOptions {
  installationId: string | number;
  fullName: string;
  /** PR head branch the verified fixes are committed to. */
  branch: string;
  /** Head SHA the review ran on; must still be the branch head. */
  headSha: string;
  runId: string;
  findings: Finding[];
  maxFindings?: number;
}

export interface AutoCommitSkip {
  findingId: string;
  paths: string[];
  reason: string;
}

export interface AutoCommitCommit {
  findingId: string;
  paths: string[];
  commitSha: string;
}

export interface AutoCommitResult {
  enabled: boolean;
  attempted: number;
  committed: AutoCommitCommit[];
  skipped: AutoCommitSkip[];
  commitSha?: string;
  note: string;
}

function commitMarker(runId: string): string {
  return `Cortado-Autocommit: ${runId}`;
}

function applyEdits(
  content: string,
  edits: Array<{ path: string; find: string; replace: string }>,
  path: string,
): { ok: true; content: string } | { ok: false; reason: string } {
  let next = content;
  for (const edit of edits) {
    if (edit.path !== path) continue;
    if (edit.find.length === 0) return { ok: false, reason: `empty find string for ${path}` };
    const first = next.indexOf(edit.find);
    if (first < 0) return { ok: false, reason: `the verified edit no longer matches ${path}` };
    if (next.indexOf(edit.find, first + 1) >= 0) return { ok: false, reason: `the verified edit is ambiguous in ${path}` };
    next = next.slice(0, first) + edit.replace + next.slice(first + edit.find.length);
  }
  return { ok: true, content: next };
}

function emptyResult(
  enabled: boolean,
  skipped: AutoCommitSkip[],
  note: string,
): AutoCommitResult {
  return { enabled, attempted: 0, committed: [], skipped, note };
}

/**
 * Commit only the findings whose repair is a verified fix, in a single atomic
 * commit on the PR head branch. Gated on `contents: write`, an unchanged head
 * SHA, a max per run, and a path deny-list (lockfiles/tests/workflows/env).
 * Idempotent per review run via a commit trailer.
 */
export async function autoCommitVerifiedFixes(
  options: AutoCommitOptions,
  deps: AutoCommitDeps = defaultAutoCommitDeps,
): Promise<AutoCommitResult> {
  const maxFindings = Math.max(1, options.maxFindings ?? DEFAULT_MAX_FINDINGS);
  const skipped: AutoCommitSkip[] = [];
  const eligible: Finding[] = [];

  for (const finding of options.findings) {
    const repair = finding.fix;
    if (finding.state !== "verified_fix" || !repair?.edits?.length) continue;
    const paths = [...new Set(repair.edits.map((edit) => edit.path))];
    const secretEdit = repair.edits.find((edit) => looksLikeSecret(edit.replace));
    if (secretEdit) {
      skipped.push({ findingId: finding.id, paths, reason: `the fix introduces what looks like a secret in ${secretEdit.path}` });
      continue;
    }
    const blocked = paths.find((path) => protectedPathReason(path));
    if (blocked) {
      skipped.push({ findingId: finding.id, paths, reason: `${protectedPathReason(blocked)} paths cannot be auto-committed (${blocked})` });
      continue;
    }
    if (eligible.length >= maxFindings) {
      skipped.push({ findingId: finding.id, paths, reason: `auto-commit limit reached (${maxFindings} per run)` });
      continue;
    }
    eligible.push(finding);
  }
  if (eligible.length === 0) {
    return emptyResult(true, skipped, skipped.length > 0 ? `No fixes were auto-committed: ${skipped[0].reason}.` : "No verified fixes to auto-commit.");
  }

  const allEligibleSkipped = (reason: string): AutoCommitResult => {
    for (const finding of eligible) skipped.push({ findingId: finding.id, paths: [...new Set(finding.fix!.edits!.map((edit) => edit.path))], reason });
    return emptyResult(true, skipped, `No fixes were auto-committed: ${reason}.`);
  };

  const permissions = await deps.getInstallationPermissions(options.installationId);
  if (permissions.contents !== "write") {
    return allEligibleSkipped("the GitHub App needs contents:write to commit verified fixes");
  }

  const headBefore = await deps.getBranchHead(options.installationId, options.fullName, options.branch).catch(() => undefined);
  if (headBefore === undefined) {
    return allEligibleSkipped(`could not read the head of ${options.branch}`);
  }
  if (headBefore !== options.headSha) {
    return allEligibleSkipped("the branch moved after the review started");
  }

  const latestMessage = await deps.getCommitMessage(options.installationId, options.fullName, options.headSha).catch(() => "");
  if (latestMessage.includes(commitMarker(options.runId))) {
    return allEligibleSkipped("this run was already auto-committed");
  }

  const baseTreeSha = await deps.getCommitTreeSha(options.installationId, options.fullName, options.headSha);
  const staged = new Map<string, string>();
  const committedByFinding: AutoCommitCommit[] = [];

  for (const finding of eligible) {
    const edits = finding.fix!.edits!;
    const paths = [...new Set(edits.map((edit) => edit.path))];
    const next = new Map(staged);
    let failure: string | undefined;
    for (const path of paths) {
      let content = next.get(path);
      if (content === undefined) {
        const file = await deps.getFileWithSha(options.installationId, options.fullName, path, options.headSha).catch(() => null);
        if (!file) {
          failure = `could not read ${path} at the reviewed commit`;
          break;
        }
        content = file.content;
      }
      const applied = applyEdits(content, edits, path);
      if (!applied.ok) {
        failure = applied.reason;
        break;
      }
      next.set(path, applied.content);
    }
    if (failure) {
      skipped.push({ findingId: finding.id, paths, reason: failure });
      continue;
    }
    for (const [path, content] of next) staged.set(path, content);
    committedByFinding.push({ findingId: finding.id, paths, commitSha: "" });
  }

  if (committedByFinding.length === 0) {
    return emptyResult(true, skipped, "No fixes were auto-committed: the verified edits no longer apply.");
  }

  const entries: Array<{ path: string; blobSha: string }> = [];
  for (const [path, content] of staged) {
    entries.push({ path, blobSha: await deps.createBlob(options.installationId, options.fullName, content) });
  }
  const treeSha = await deps.createTreeWithChanges(options.installationId, options.fullName, baseTreeSha, entries);

  const claims = committedByFinding
    .map((entry) => {
      const finding = eligible.find((item) => item.id === entry.findingId);
      return `- ${finding?.claim.slice(0, 160) ?? entry.findingId} (${entry.paths.join(", ")})`;
    })
    .join("\n");
  const message = [
    `fix: ${committedByFinding.length} verified Cortado fix(es)`,
    "",
    claims,
    "",
    commitMarker(options.runId),
  ].join("\n");

  const commitSha = await deps.createCommit(options.installationId, options.fullName, {
    message,
    treeSha,
    parentSha: options.headSha,
  });

  try {
    await deps.updateRef(options.installationId, options.fullName, options.branch, commitSha);
  } catch {
    return emptyResult(true, skipped, "No fixes were auto-committed: the branch moved before the commit could land.");
  }

  for (const entry of committedByFinding) entry.commitSha = commitSha;
  const paths = [...new Set(committedByFinding.flatMap((entry) => entry.paths))];
  return {
    enabled: true,
    attempted: eligible.length,
    committed: committedByFinding,
    skipped,
    commitSha,
    note: `Auto-committed ${committedByFinding.length} verified fix(es) to \`${options.branch}\`: ${paths.join(", ")} (\`${commitSha.slice(0, 7)}\`).`,
  };
}
