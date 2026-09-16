import type { Candidate, Severity } from "./types";
import { stableId } from "./util";

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 5, high: 4, medium: 3, low: 2, info: 1 };

function claimTokens(claim: string): Set<string> {
  return new Set(
    claim
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length > 3),
  );
}

function normalizedClaim(claim: string): string {
  return [...claimTokens(claim)].sort().slice(0, 12).join(" ");
}

/** Token overlap between two claims, used to merge near-duplicate findings (3.4). */
function claimOverlap(a: Candidate, b: Candidate): number {
  const left = claimTokens(a.claim);
  const right = claimTokens(b.claim);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

export function mergeCandidates(detectors: Candidate[], luna: Candidate[], maxCandidates: number): Candidate[] {
  const kept: Candidate[] = [];
  const seen = new Set<string>();

  const overlap = (a: Candidate, b: Candidate): boolean => {
    if (a.file && b.file && a.file === b.file && a.line !== undefined && b.line !== undefined) {
      if (Math.abs(a.line - b.line) <= 4) return true;
    }
    const aTags = new Set(a.tags);
    const bTags = new Set(b.tags);
    // Near-duplicate claims in the same file (e.g. two investigators describing
    // the same defect with different wording) must merge, or the loop pays to
    // prove and repair the same bug twice (3.4).
    if (a.file && b.file && a.file === b.file && claimOverlap(a, b) >= 0.65) return true;
    return normalizedClaim(a.claim) === normalizedClaim(b.claim) && [...aTags].some((tag) => bTags.has(tag));
  };

  for (const candidate of [...detectors, ...luna]) {
    if (kept.some((existing) => overlap(existing, candidate))) continue;
    const key = stableId("k", candidate.file ?? "", String(candidate.line ?? ""), normalizedClaim(candidate.claim));
    if (seen.has(key)) continue;
    seen.add(key);
    // Copy so scoring never mutates caller-owned (possibly cached) candidates.
    kept.push({ ...candidate });
  }

  for (const candidate of kept) {
    const detectorBoost = candidate.source === "detector" ? 3 : 0;
    const proofBoost = candidate.check ? 2 : 0;
    candidate.score = SEVERITY_WEIGHT[candidate.severity] * 2 + candidate.confidence * 3 + detectorBoost + proofBoost;
  }

  return kept
    .sort((a, b) => b.score - a.score || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0))
    .slice(0, maxCandidates)
    .map((candidate, index) => ({ ...candidate, score: Number((candidate.score - index * 0.001).toFixed(4)) }));
}
