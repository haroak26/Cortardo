import type { Candidate, PRContext } from "./types";

/**
 * Every test file the run knows about: the repo-wide index captured from the
 * sandbox plus the tests changed in the PR. 3.3 only knew the latter, which is
 * why `targeted_test` proofs were almost never available on real PRs (3.4).
 */
export function repoTestIndex(context: PRContext): string[] {
  return [...new Set([...(context.repoTests ?? []), ...context.tests])];
}

/**
 * Test files that genuinely cover a source file (no substring false positives).
 * Prefers same-basename matches; callers may fall back to the full index.
 */
export function relatedTestsFor(candidate: Candidate, context: PRContext): string[] {
  if (!candidate.file) return [];
  const base = candidate.file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (base.length === 0) return [];
  return repoTestIndex(context).filter((test) => {
    const testBase = test.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    return testBase === base || testBase.startsWith(`${base}.`) || testBase.startsWith(`${base}-`);
  });
}
