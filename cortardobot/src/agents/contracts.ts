import { z } from "zod";

const SEVERITIES = ["critical", "high", "medium", "low", "info"] as const;

const severitySchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(SEVERITIES).catch("medium"),
);

const confidenceSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") {
      const parsed = Number(value.replace("%", ""));
      if (Number.isFinite(parsed)) return parsed > 1 ? parsed / 100 : parsed;
      return 0.5;
    }
    if (typeof value === "number" && value > 1 && value <= 100) return value / 100;
    return value;
  },
  z.number().min(0).max(1).catch(0.5),
);

function clippedString(max: number, min = 1) {
  return z
    .string()
    .transform((value) => (value.length > max ? value.slice(0, max) : value))
    .refine((value) => value.trim().length >= min, { message: `must be at least ${min} characters` });
}

function optionalClippedString(max: number, min = 2) {
  return z.preprocess(
    (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
    clippedString(max, min).optional(),
  );
}

const evidenceSchema = z.preprocess(
  (value) => {
    if (typeof value === "string") return [value];
    if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
    return value;
  },
  z.array(z.string().min(1)).min(1).max(8).transform((entries) => entries.slice(0, 8)),
);

export const hypothesisSchema = z.object({
  claim: clippedString(400, 4),
  evidence: evidenceSchema,
  severity: severitySchema,
  confidence: confidenceSchema,
  suggestedExperiment: clippedString(300, 4),
  rule: z.string().max(80).optional(),
});

export const hypothesisListSchema = z.object({
  hypotheses: z.array(hypothesisSchema).max(6).transform((items) => items.slice(0, 2)),
});

const verdictSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(["PROVE", "STATIC_ONLY", "DISCARD"]).catch("STATIC_ONLY"),
);

export const judgeSchema = z.object({
  decisions: z
    .array(
      z.object({
        hypothesisId: z.string().min(1),
        verdict: verdictSchema,
        reason: clippedString(300, 2),
        priority: z.coerce.number().int().min(1).max(10).catch(5),
        reproductionCommand: optionalClippedString(400, 2),
      }),
    )
    .min(1),
});

export const repairPlanSchema = z.object({
  strategy: optionalClippedString(300, 2),
  files: z.array(z.string()).max(8).catch([]),
  rationale: clippedString(600, 2),
});

export const repairPatchSchema = z.object({
  patch: z.string().min(1).max(200_000),
  description: clippedString(400, 2),
  strategy: optionalClippedString(300, 2),
});

export const diagnosisSchema = z.object({
  reason: clippedString(400, 2),
  nextStrategy: clippedString(300, 2),
});

const reviewValidity = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["valid", "uncertain", "invalid"]).catch("uncertain"),
);
const reviewFix = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["correct", "partial", "incorrect", "none"]).catch("none"),
);
const reviewRisk = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["high", "medium", "low"]).catch("medium"),
);
const reviewApproval = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.enum(["approve", "approve_with_comments", "request_changes"]).catch("approve_with_comments"),
);

export const finalReviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        candidateId: z.string().min(1),
        validity: reviewValidity,
        fixCorrectness: reviewFix,
        risk: reviewRisk,
        approval: reviewApproval,
        confidence: confidenceSchema,
        summary: clippedString(600, 2),
      }),
    )
    .min(1),
});

export type HypothesisPayload = z.infer<typeof hypothesisSchema>;
export type JudgePayload = z.infer<typeof judgeSchema>;
export type RepairPlanPayload = z.infer<typeof repairPlanSchema>;
export type RepairPatchPayload = z.infer<typeof repairPatchSchema>;
export type DiagnosisPayload = z.infer<typeof diagnosisSchema>;
export type FinalReviewPayload = z.infer<typeof finalReviewSchema>;
