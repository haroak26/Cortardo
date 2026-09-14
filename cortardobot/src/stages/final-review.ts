import type { CortadoConfig } from "../config";
import type { FinalReview, Finding, PRContext } from "../types";
import { extractJson } from "../util/json";
import { finalReviewSchema } from "../agents/contracts";
import { finalReviewSystemPrompt, finalReviewUserPrompt } from "../agents/prompts";
import type { Logger } from "../util/logger";
import type { ModelRouter } from "../models/router";

export interface FinalReviewDeps {
  models: ModelRouter;
  config: CortadoConfig;
  logger: Logger;
}

export function deterministicFinalReview(finding: Finding): FinalReview {
  const confirmed = finding.proof.status === "confirmed";
  const verified = finding.repair?.exit === "VERIFIED" && (finding.verification?.passed ?? false);
  const unresolved = finding.repair?.exit === "UNRESOLVED" || finding.repair?.exit === "BUDGET_EXHAUSTED";
  const unsafe = finding.repair?.exit === "UNSAFE";
  const repairAttempted = finding.repair !== undefined;
  return {
    candidateId: finding.candidateId,
    validity: confirmed ? "valid" : finding.proof.status === "likely" ? "uncertain" : "invalid",
    fixCorrectness: verified ? "correct" : "none",
    risk: unsafe || finding.severity === "critical" ? "high" : finding.severity === "high" ? "medium" : "low",
    approval: verified ? "approve" : confirmed && repairAttempted ? "request_changes" : "approve_with_comments",
    confidence: verified ? 0.9 : confirmed ? 0.75 : finding.proof.status === "likely" ? 0.55 : 0.3,
    summary: verified
      ? `Confirmed ${finding.severity} finding; the fix passed verification.`
      : unsafe
        ? "Repair attempt was unsafe and rejected."
        : unresolved
          ? "Confirmed finding could not be fixed within the repair budget."
          : "Finding was not confirmed by execution.",
  };
}

export async function reviewFindings(
  findings: Finding[],
  context: PRContext,
  deps: FinalReviewDeps,
): Promise<FinalReview[]> {
  if (findings.length === 0) return [];
  const fallback = new Map(findings.map((finding) => [finding.candidateId, deterministicFinalReview(finding)]));
  try {
    const response = await deps.models.complete({
      role: "astra",
      kind: "final_review",
      system: finalReviewSystemPrompt(),
      user: finalReviewUserPrompt(
        findings.map((finding) => ({
          candidate: {
            id: finding.candidateId,
            claim: finding.title,
            severity: finding.severity,
            confidence: finding.confidence,
            evidence: finding.evidence,
            suggestedExperiment: "",
            tags: [],
            agent: "",
            agentKind: "bug",
            mergedFrom: [],
            occurrences: 1,
            score: 0,
            file: finding.file,
          },
          proofStatus: finding.proof.status,
          repair: finding.repair,
          verification: finding.verification,
          diff: finding.repair?.finalPatch ?? "",
        })),
      ),
      expectJson: true,
      context: {
        items: findings.map((finding) => ({
          candidateId: finding.candidateId,
          severity: finding.severity,
          proofStatus: finding.proof.status,
          repairExit: finding.repair?.exit,
          verificationPassed: finding.verification?.passed,
          repairAttempts: finding.repair?.attempts.length ?? 0,
        })),
      },
      label: "astra-final-review",
    });
    const parsed = finalReviewSchema.parse(extractJson(response.text));
    const seen = new Set<string>();
    const reviews: FinalReview[] = [];
    for (const review of parsed.reviews) {
      if (!fallback.has(review.candidateId) || seen.has(review.candidateId)) continue;
      seen.add(review.candidateId);
      reviews.push(review);
    }
    for (const [candidateId, review] of fallback) {
      if (!seen.has(candidateId)) reviews.push(review);
    }
    return reviews;
  } catch (error) {
    deps.logger.warn("final review fell back to deterministic verdicts", {
      error: error instanceof Error ? error.message : String(error),
    });
    return findings.map((finding) => fallback.get(finding.candidateId)!);
  }
}
