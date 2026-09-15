import { z } from "zod";
import type { AstraReview, Candidate, ProofResult, RepairResult, VerificationReport } from "./types";
import type { ModelRouter } from "./models";
import { extractJson, renderLearnings, truncate, type Logger } from "./util";

const reviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        candidateId: z.string(),
        validity: z.enum(["valid", "uncertain", "invalid"]).catch("uncertain"),
        fixCorrectness: z.enum(["correct", "partial", "incorrect", "none"]).catch("none"),
        risk: z.enum(["high", "medium", "low"]).catch("medium"),
        approval: z.enum(["approve", "approve_with_comments", "request_changes"]).catch("approve_with_comments"),
        confidence: z.coerce.number().min(0).max(1).catch(0.6),
        summary: z
          .string()
          .min(2)
          .transform((value) => (value.length > 699 ? `${value.slice(0, 696)}...` : value)),
      }),
    )
    .min(1),
});

export interface AstraInput {
  candidate: Candidate;
  proof: ProofResult;
  repair?: RepairResult;
  verification?: VerificationReport;
}

const SYSTEM = [
  "You are Astra, the final independent reviewer for an autonomous code review bot.",
  "Judge the validity of each finding and the correctness of the applied fix using only the evidence provided.",
  "Be skeptical: if the reproduction is only static or verification is missing, lower confidence and request changes.",
  "Return JSON only: {\"reviews\":[{\"candidateId\":\"...\",\"validity\":\"valid\",\"fixCorrectness\":\"correct\",\"risk\":\"low\",\"approval\":\"approve\",\"confidence\":0.9,\"summary\":\"...\"}]}",
].join("\n");

export function fallbackReviews(items: AstraInput[]): AstraReview[] {
  return items.map((item) => {
    const fixed = item.repair?.exit === "VERIFIED" && item.verification?.passed !== false;
    return {
      candidateId: item.candidate.id,
      validity: item.proof.status === "confirmed" ? "valid" : "uncertain",
      fixCorrectness: fixed ? "correct" : item.repair?.exit === "VERIFIED" ? "partial" : "none",
      risk: item.candidate.severity === "critical" || item.candidate.severity === "high" ? "high" : "medium",
      approval: fixed && item.candidate.severity !== "critical" ? "approve" : "request_changes",
      confidence: Math.min(0.95, Math.max(0.4, item.candidate.confidence)),
      summary: fixed
        ? `Confirmed and fixed: ${item.candidate.claim.slice(0, 200)}`
        : `Confirmed but not fully verified: ${item.candidate.claim.slice(0, 200)}`,
    };
  });
}

export async function finalReview(items: AstraInput[], models: ModelRouter, logger: Logger, learnings?: string[]): Promise<AstraReview[]> {
  if (items.length === 0) return [];
  try {
    const blocks = items
      .map((item) => {
        const attempts = item.repair?.attempts.map((attempt) => `attempt ${attempt.attempt}: ${attempt.strategy}`).join(" -> ") ?? "none";
        const verification = item.verification
          ? item.verification.steps
              .filter((step) => !step.skipped)
              .map((step) => `${step.kind}:${step.passed ? "pass" : "fail"}`)
              .join(", ") || "no executed steps"
          : "none";
        return [
          `## Finding ${item.candidate.id}`,
          `Claim: ${item.candidate.claim}`,
          `Severity: ${item.candidate.severity} | Confidence: ${item.candidate.confidence}`,
          `Evidence: ${item.candidate.evidence.join(", ")}`,
          `Proof (${item.proof.strategy}): ${item.proof.status} — ${truncate(item.proof.explanation, 300)}`,
          `Reproduction: ${truncate(item.proof.reproduction, 400)}`,
          `Repair: ${item.repair?.exit ?? "not attempted"} (${attempts})`,
          `Final patch:\n${truncate(item.repair?.finalPatch ?? "none", 1200)}`,
          `Verification: ${verification}`,
        ].join("\n");
      })
      .join("\n\n");
    const learningsText = renderLearnings(learnings);
    const response = await models.complete({
      role: "astra",
      kind: "final_review",
      system: SYSTEM,
      user: [
        `Findings:\n${blocks}`,
        learningsText ? `Repository learnings (respect these when reviewing):\n${learningsText}` : "",
        "Return the review JSON now.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      expectJson: true,
      label: "astra-final",
    });
    const parsed = reviewSchema.safeParse(extractJson(response.text));
    if (!parsed.success) throw new Error(`invalid astra JSON: ${parsed.error.message.slice(0, 200)}`);
    const byId = new Map(items.map((item) => [item.candidate.id, item]));
    const reviews: AstraReview[] = [];
    for (const review of parsed.data.reviews) {
      if (!byId.has(review.candidateId)) continue;
      reviews.push({ ...review, summary: review.summary.slice(0, 700) });
    }
    if (reviews.length !== items.length) {
      const seen = new Set(reviews.map((review) => review.candidateId));
      reviews.push(...fallbackReviews(items.filter((item) => !seen.has(item.candidate.id))));
    }
    return reviews;
  } catch (error) {
    logger.warn("astra review fell back to deterministic review", { error: error instanceof Error ? error.message : String(error) });
    return fallbackReviews(items);
  }
}
