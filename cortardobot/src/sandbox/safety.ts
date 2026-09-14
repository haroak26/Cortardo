export interface CommandSafety {
  allowed: boolean;
  reason?: string;
}

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[a-z]*\s+)*-[a-z]*r[a-z]*f?\s+\/(?:\s|$)/i, reason: "recursive delete of filesystem root" },
  { pattern: /\brm\s+-rf\s+[~$]/i, reason: "recursive delete of home directory" },
  { pattern: /\bsudo\b/i, reason: "privilege escalation" },
  { pattern: /\bmkfs(\.|\s)/i, reason: "filesystem formatting" },
  { pattern: /\bdd\s+if=/i, reason: "raw disk write" },
  { pattern: /:\(\)\s*{\s*:\|:&\s*}\s*;:/, reason: "fork bomb" },
  { pattern: /(curl|wget)[^|;&]*\|[^|;&]*(sh|bash|zsh)\b/i, reason: "pipe remote content into a shell" },
  { pattern: /\bgit\s+push\b.*--force/i, reason: "force push" },
  { pattern: /\bnpm\s+publish\b/i, reason: "publishing a package" },
  { pattern: /\.ssh\/id_/i, reason: "reading SSH private keys" },
  { pattern: /\bchmod\s+777\b/i, reason: "world-writable permissions" },
  { pattern: /\bshutdown\b|\breboot\b/i, reason: "host shutdown" },
];

export function assessCommand(command: string): CommandSafety {
  const normalized = command.trim();
  if (normalized.length === 0) return { allowed: false, reason: "empty command" };
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(normalized)) {
      return { allowed: false, reason: rule.reason };
    }
  }
  return { allowed: true };
}

export interface PatchSafetyFinding {
  path: string;
  reason: string;
}

const RESTRICTED_PATHS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^\.github\/workflows\//, reason: "CI workflow changes require human review" },
  { pattern: /(^|\/)\.env(\.|$)/, reason: "environment secret files must not be patched automatically" },
  { pattern: /(^|\/)package-lock\.json$/, reason: "lockfile rewrites are not safe for automated repair" },
  { pattern: /(^|\/)yarn\.lock$/, reason: "lockfile rewrites are not safe for automated repair" },
  { pattern: /(^|\/)pnpm-lock\.yaml$/, reason: "lockfile rewrites are not safe for automated repair" },
];

export function assessPatchSafety(
  patch: string,
  parsed: Array<{ path: string; removedLines: string[]; addedLines: string[] }>,
): PatchSafetyFinding[] {
  const findings: PatchSafetyFinding[] = [];
  for (const file of parsed) {
    if (!file.path || file.path.startsWith("/") || file.path.split("/").includes("..")) {
      findings.push({ path: file.path || "(empty)", reason: "patch targets a path outside the repository" });
      continue;
    }
    for (const rule of RESTRICTED_PATHS) {
      if (rule.pattern.test(file.path)) {
        findings.push({ path: file.path, reason: rule.reason });
      }
    }
    const isTestFile = /\.(test|spec)\.|__tests__|\/tests?\//.test(file.path);
    if (isTestFile) {
      const removedAssertions = file.removedLines.filter((line) =>
        /expect\s*\(|assert[.(]|\.toBe|\.toEqual|describe\s*\(|it\s*\(|test\s*\(/.test(line),
      );
      const addedAssertions = file.addedLines.filter((line) =>
        /expect\s*\(|assert[.(]|\.toBe|\.toEqual|describe\s*\(|it\s*\(|test\s*\(/.test(line),
      );
      if (removedAssertions.length > addedAssertions.length) {
        findings.push({
          path: file.path,
          reason: "patch removes test assertions or blocks",
        });
      }
    }
  }
  if (/\bdrop\s+table\b|\btruncate\s+table\b/i.test(patch)) {
    findings.push({ path: "*", reason: "patch contains a destructive database statement" });
  }
  return findings;
}
