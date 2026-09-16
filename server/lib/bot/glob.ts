/**
 * Minimal glob matcher for review exclusion patterns.
 * Supports `**` (any path segments), `*` (anything but `/`), `?` and literal
 * text. Patterns without a slash also match against the file's basename, so
 * `*.lock` skips lockfiles at any depth.
 */

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  let source = "";
  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    if (char === "*") {
      if (normalized[i + 1] === "*") {
        source += ".*";
        i += 1;
        if (normalized[i + 1] === "/") i += 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += escapeRegExp(char);
    }
  }
  return new RegExp(`^${source}$`);
}

export function matchesGlob(path: string, pattern: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").replace(/^\/+/, "");
  const normalizedPattern = pattern.trim().replace(/^\.\//, "").replace(/^\/+/, "");
  if (!normalizedPattern) return false;
  const regex = globToRegExp(normalizedPattern);
  if (regex.test(normalizedPath)) return true;
  if (!normalizedPattern.includes("/")) {
    const base = normalizedPath.split("/").pop() ?? normalizedPath;
    return regex.test(base);
  }
  return false;
}

export function matchesAnyGlob(path: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matchesGlob(path, pattern));
}
