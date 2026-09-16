import { z } from "zod";
import type { ReviewRequest } from "./types";

const changedFileSchema = z.object({
  path: z.string().min(1),
  previousPath: z.string().optional(),
  status: z.enum(["added", "modified", "removed", "renamed"]).optional(),
  patch: z.string().optional(),
  content: z.string().optional(),
  additions: z.number().optional(),
  deletions: z.number().optional(),
});

const requestSchema = z.object({
  runId: z.string().min(1),
  repo: z.object({
    fullName: z.string().min(1),
    defaultBranch: z.string(),
    installationId: z.coerce.number(),
    cloneUrl: z.string().min(1),
    token: z.string(),
  }),
  pr: z.object({
    number: z.coerce.number().int().positive(),
    title: z.string().default(""),
    body: z.string().default(""),
    author: z.string().optional(),
    baseSha: z.string().default(""),
    headSha: z.string().default(""),
    baseBranch: z.string().default(""),
    headBranch: z.string().default(""),
    url: z.string().optional(),
  }),
  files: z.array(changedFileSchema).max(2_000),
  rules: z.array(z.string()).optional(),
  learnings: z.array(z.string()).optional(),
  settings: z.unknown().optional(),
  budgets: z.unknown().optional(),
});

export type RequestValidation = { ok: true; value: ReviewRequest } | { ok: false; error: string };

/**
 * Validates the engine boundary so a malformed request fails as a clear
 * `status:"failed"` result instead of throwing out of `run()` (3.3).
 */
export function validateReviewRequest(request: unknown): RequestValidation {
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "request";
    return { ok: false, error: `${path}: ${issue?.message ?? "invalid review request"}` };
  }
  return { ok: true, value: parsed.data as unknown as ReviewRequest };
}
