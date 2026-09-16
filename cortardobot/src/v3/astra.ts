import { z } from "zod";
import type {
  AstraReview,
  AuthoredProbe,
  Candidate,
  FinalReviewReport,
  JudgeDecision,
  LoopCoverage,
  PRContext,
  ProofResult,
  RepairResult,
  ReviewRisk,
  ReviewRiskLevel,
  VerificationReport,
} from "./types";
import type { ModelRouter } from "./models";
import { extractJson, renderLearnings, truncate, type Logger } from "./util";
import { renderCompactDiff } from "./patch";

const decisionSchema = z.enum(["approve", "approve_with_comments", "request_changes"]).catch("approve_with_comments");

const reviewSchema = z.object({
  reviews: z
    .array(
      z.object({
        candidateId: z.string(),
        validity: z.enum(["valid", "uncertain", "invalid"]).catch("uncertain"),
        fixCorrectness: z.enum(["correct", "partial", "incorrect", "none"]).catch("none"),
        risk: z.enum(["high", "medium", "low"]).catch("medium"),
        approval: decisionSchema,
        confidence: z.coerce.number().min(0).max(1).catch(0.6),
        summary: z
          .string()
          .min(2)
          .transform((value) => (value.length > 699 ? `${value.slice(0, 696)}...` : value)),
        rationale: z
          .string()
          .optional()
          .transform((value) => (value && value.length > 1_399 ? `${value.slice(0, 1_396)}...` : value)),
        evidenceRefs: z.array(z.string()).max(12).optional(),
      }),
    )
    .min(1),
});

const walkthroughSchema = z.object({
  file: z.string(),
  intent: z.string(),
  changeSummary: z.string(),
  risk: z.enum(["high", "medium", "low"]).catch("medium"),
  notes: z.string().optional(),
});

const riskSchema = z.object({
  area: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]).catch("medium"),
  rationale: z.string(),
  mitigation: z.string().optional(),
});

const reportSchema = z.object({
  verdict: z.object({
    decision: decisionSchema,
    confidence: z.coerce.number().min(0).max(1).catch(0.5),
    rationale: z.string().min(2),
  }),
  summary: z.string().min(2),
  walkthrough: z.array(walkthroughSchema).max(30).catch([]),
  risks: z.array(riskSchema).max(20).catch([]),
  testCoverage: z
    .object({
      assessed: z.boolean().catch(false),
      signals: z.array(z.string()).max(20).catch([]),
      gaps: z.array(z.string()).max(20).catch([]),
    })
    .catch({ assessed: false, signals: [], gaps: [] }),
  observations: z.array(z.object({ kind: z.string(), detail: z.string() })).max(20).catch([]),
  limitations: z.array(z.string()).max(20).catch([]),
});

export interface AstraInput {
  candidate: Candidate;
  proof: ProofResult;
  repair?: RepairResult;
  verification?: VerificationReport;
}

export interface FinalReviewInput {
  items: AstraInput[];
  context: PRContext;
  instructions?: string;
  learnings?: string[];
  /** All candidates in the run, used to describe unproven/static findings (3.4). */
  candidates?: Candidate[];
  /** Judge decisions, used to populate findingsSummary (3.4). */
  decisions?: JudgeDecision[];
  /** Loop coverage for judge-approved candidates (3.4). */
  loop?: LoopCoverage;
  /** Cancellation signal from the owning stage (3.3). */
  signal?: AbortSignal;
}

export interface FinalReviewOutcome {
  reviews: AstraReview[];
  report: FinalReviewReport;
}

const REVIEW_SYSTEM = [
  "You are the independent final reviewer for an autonomous code review bot.",
  "You did not write the fix. Judge the validity of each finding and the correctness of the applied fix using only the evidence provided.",
  "Be skeptical: if the reproduction is only static, or verification is missing or failed, lower confidence and request changes.",
  "Every conclusion must cite the evidence you used (file:line anchors or verification step names) in evidenceRefs.",
  'Return JSON only: {"reviews":[{"candidateId":"...","validity":"valid","fixCorrectness":"correct","risk":"low","approval":"approve","confidence":0.9,"summary":"...","rationale":"...","evidenceRefs":["src/a.ts:12"]}]}',
].join("\n");

const REPORT_SYSTEM = [
  "You are the independent final reviewer for an autonomous code review bot writing the PR-level review.",
  "You are given the pull request, its compact diff, and the outcome of every confirmed finding (proof, repair, verification).",
  "Write a review a senior engineer would trust: a decisive verdict, an in-depth summary, a per-file walkthrough, concrete risks, a test-coverage assessment, notable observations and explicit limitations.",
  "Ground every claim in the provided diff, findings or verification evidence. Never invent files, tests or behaviour you cannot see.",
  "Unproven or static-only candidates are labelled as such: call them out explicitly in limitations and never describe them as fixed or verified.",
  "If evidence is insufficient, say so in limitations and lower confidence instead of guessing.",
  "When all confirmed findings are fixed and verified and the change is low risk, approve. When fixes are unverified or risks remain, request changes.",
  'Return JSON only: {"verdict":{"decision":"approve|approve_with_comments|request_changes","confidence":0.0,"rationale":"..."},"summary":"...","walkthrough":[{"file":"path","intent":"...","changeSummary":"...","risk":"low","notes":"..."}],"risks":[{"area":"...","severity":"low","rationale":"...","mitigation":"..."}],"testCoverage":{"assessed":true,"signals":["..."],"gaps":["..."]},"observations":[{"kind":"...","detail":"..."}],"limitations":["..."]}',
].join("\n");

function fixed(repair: RepairResult | undefined, verification: VerificationReport | undefined): boolean {
  return repair?.exit === "VERIFIED" && verification?.passed !== false && verification !== undefined;
}

export function fallbackReviews(items: AstraInput[]): AstraReview[] {
  return items.map((item) => {
    const isFixed = fixed(item.repair, item.verification);
    return {
      candidateId: item.candidate.id,
      validity: item.proof.status === "confirmed" ? "valid" : "uncertain",
      fixCorrectness: isFixed ? "correct" : item.repair?.exit === "VERIFIED" ? "partial" : "none",
      risk: item.candidate.severity === "critical" || item.candidate.severity === "high" ? "high" : "medium",
      approval: isFixed && item.candidate.severity !== "critical" ? "approve" : "request_changes",
      confidence: Math.min(0.95, Math.max(0.4, item.candidate.confidence)),
      summary: isFixed
        ? `Confirmed and fixed: ${item.candidate.claim.slice(0, 200)}`
        : `Confirmed but not fully verified: ${item.candidate.claim.slice(0, 200)}`,
      rationale: item.verification
        ? `Deterministic fallback review. Verification ${item.verification.passed ? "passed" : "failed"}; repair ${item.repair?.exit ?? "not attempted"}.`
        : `Deterministic fallback review. Repair ${item.repair?.exit ?? "not attempted"} with no verification report.`,
      evidenceRefs: item.candidate.evidence.slice(0, 6),
    };
  });
}

function findingsSummary(items: AstraInput[], input?: FinalReviewInput): FinalReviewReport["findingsSummary"] {
  const confirmed = items.filter((item) => item.proof.status === "confirmed").length;
  const verified = items.filter((item) => fixed(item.repair, item.verification)).length;
  const decisions = input?.decisions ?? [];
  const loop = input?.loop;
  return {
    confirmed,
    verified,
    unresolved: confirmed - verified,
    staticOnly: decisions.filter((decision) => decision.verdict === "STATIC_ONLY").length,
    discarded: decisions.filter((decision) => decision.verdict === "DISCARD").length,
    proofUnavailable: loop ? loop.proofUnavailable + loop.proofErrors : 0,
  };
}

/**
 * A digest of everything the loop could not prove: judge-approved candidates
 * the prover could not reproduce and static-only high/medium findings. The
 * 3.3 report never saw these, which is why a run with a dead loop still read
 * as a confident static review (3.4).
 */
function unprovenDigest(input: FinalReviewInput): string {
  const candidates = new Map((input.candidates ?? []).map((candidate) => [candidate.id, candidate]));
  const decisions = new Map((input.decisions ?? []).map((decision) => [decision.candidateId, decision]));
  const loopById = new Map((input.loop?.candidates ?? []).map((entry) => [entry.candidateId, entry]));
  const lines: string[] = [];
  const seen = new Set<string>();

  for (const entry of input.loop?.candidates ?? []) {
    if (entry.proofState === "PROVEN") continue;
    const candidate = candidates.get(entry.candidateId);
    if (!candidate) continue;
    seen.add(candidate.id);
    lines.push(`- [${candidate.severity}] ${candidate.claim} (\`${candidate.file ?? "n/a"}:${candidate.line ?? "?"}\`) — unproven (${entry.proofState}): ${entry.reason}`);
  }
  for (const decision of decisions.values()) {
    if (decision.verdict !== "STATIC_ONLY" || seen.has(decision.candidateId)) continue;
    const candidate = candidates.get(decision.candidateId);
    if (!candidate) continue;
    const severity = candidate.severity;
    if (severity !== "high" && severity !== "medium" && severity !== "critical") continue;
    lines.push(`- [${severity}] ${candidate.claim} (\`${candidate.file ?? "n/a"}:${candidate.line ?? "?"}\`) — static only: ${decision.reason}`);
  }
  return lines.slice(0, 12).join("\n");
}

function fallbackDecision(items: AstraInput[]): "approve" | "approve_with_comments" | "request_changes" {
  if (items.length === 0) return "approve";
  if (items.some((item) => !fixed(item.repair, item.verification) && (item.candidate.severity === "critical" || item.candidate.severity === "high"))) {
    return "request_changes";
  }
  if (items.some((item) => !fixed(item.repair, item.verification))) return "approve_with_comments";
  return "approve";
}

export function fallbackReport(input: FinalReviewInput, reason = "the independent reviewer model did not run"): FinalReviewReport {
  const caps = findingsSummary(input.items, input);
  const decision = fallbackDecision(input.items);
  const riskSignals: ReviewRisk[] = input.context.riskSignals.slice(0, 10).map((signal) => ({
    area: "risk signal",
    severity: "medium" as ReviewRiskLevel,
    rationale: truncate(signal, 400),
  }));
  return {
    verdict: {
      decision,
      confidence: decision === "approve" ? 0.5 : 0.6,
      rationale: `Deterministic fallback verdict: ${caps.confirmed} confirmed finding(s), ${caps.verified} fixed and verified, ${caps.unresolved} unresolved.`,
    },
    summary: `${input.context.title}: ${input.context.files.length} changed file(s), +${input.context.additions}/-${input.context.deletions}. ${caps.confirmed} confirmed finding(s); ${caps.verified} verified fix(es); ${caps.unresolved} unresolved.`,
    walkthrough: input.context.files.slice(0, 20).map((file) => ({
      file: file.path,
      intent: `Change in ${file.path}`,
      changeSummary: `${file.status}, +${file.additions}/-${file.deletions}`,
      risk: "medium" as const,
    })),
    risks: riskSignals,
    testCoverage: {
      assessed: input.context.hasTests,
      signals: input.context.tests.slice(0, 10),
      gaps: input.context.hasTests ? [] : ["no test command was detected for this repository"],
    },
    observations: [],
    limitations: [
      `Deterministic fallback: ${reason}.`,
      ...(caps.proofUnavailable && caps.proofUnavailable > 0 ? [`${caps.proofUnavailable} judge-approved candidate(s) could not be proven by execution.`] : []),
    ],
    findingsSummary: caps,
    source: "fallback",
  };
}

const DECISION_RANK = { approve: 0, approve_with_comments: 1, request_changes: 2 } as const;

/**
 * Hard guardrails: the reviewer can never approve past unresolved high/critical
 * findings, and a report that lacks verification can never be an approval.
 */
export function applyVerdictGuardrails(report: FinalReviewReport, items: AstraInput[]): FinalReviewReport {
  const minimum = fallbackDecision(items);
  if (DECISION_RANK[report.verdict.decision] >= DECISION_RANK[minimum]) return report;
  return {
    ...report,
    verdict: {
      ...report.verdict,
      decision: minimum,
      confidence: Math.min(report.verdict.confidence, 0.6),
      rationale: `${report.verdict.rationale}\n\nVerdict raised by the deterministic guardrail: unresolved findings forbid a weaker decision (${minimum}).`,
    },
    limitations: [...report.limitations, "The verdict was raised by a deterministic guardrail over unresolved findings."],
  };
}

function probeBlock(probe: AuthoredProbe | undefined): string {
  if (!probe) return "";
  return [`Promoted probe (${probe.name}, pre-fix ${probe.passed ? "passing" : "failing"}):`, truncate(probe.content, 600), `Command: ${probe.command}`].join("\n");
}

function findingBlock(item: AstraInput): string {
  const attempts = item.repair?.attempts.map((attempt) => `attempt ${attempt.attempt}: ${attempt.strategy}`).join(" -> ") ?? "none";
  const verification = item.verification
    ? item.verification.steps
        .filter((step) => !step.skipped)
        .map((step) => `${step.kind}:${step.passed ? "pass" : "fail"} — ${truncate(step.reason, 200)}${step.output ? `\n${truncate(step.output, 240)}` : ""}`)
        .join("\n") || "no executed steps"
    : "none";
  return [
    `## Finding ${item.candidate.id}`,
    `Claim: ${item.candidate.claim}`,
    `Kind: ${item.candidate.agentKind} | Severity: ${item.candidate.severity} | Confidence: ${item.candidate.confidence}`,
    `Evidence: ${item.candidate.evidence.slice(0, 10).join(", ")}`,
    `Proof (${item.proof.strategy}): ${item.proof.status} — ${truncate(item.proof.explanation, 700)}`,
    `Reproduction: ${truncate(item.proof.reproduction, 800)}`,
    `Repair: ${item.repair?.exit ?? "not attempted"} (${attempts})`,
    `Final patch:\n${truncate(item.repair?.finalPatch ?? "none", 4_000)}`,
    probeBlock(item.repair?.probe),
    `Verification:\n${verification}`,
  ]
    .filter(Boolean)
    .join("\n");
}

async function reviewFindings(items: AstraInput[], models: ModelRouter, input: FinalReviewInput): Promise<AstraReview[]> {
  const learnings = renderLearnings(input.learnings);
  const response = await models.complete({
    role: "astra",
    kind: "final_review",
    system: REVIEW_SYSTEM,
    user: [
      `Findings:\n${items.map(findingBlock).join("\n\n")}`,
      learnings ? `Repository learnings (respect these when reviewing):\n${learnings}` : "",
      "Return the review JSON now.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    expectJson: true,
    maxTokens: 8_000,
    signal: input.signal,
    label: "astra-final",
  });
  const parsed = reviewSchema.safeParse(extractJson(response.text));
  if (!parsed.success) throw new Error(`invalid astra JSON: ${parsed.error.message.slice(0, 200)}`);
  const byId = new Map(items.map((item) => [item.candidate.id, item]));
  const reviews: AstraReview[] = [];
  const seen = new Set<string>();
  for (const review of parsed.data.reviews) {
    if (!byId.has(review.candidateId) || seen.has(review.candidateId)) continue;
    seen.add(review.candidateId);
    reviews.push({ ...review, summary: review.summary.slice(0, 700) });
  }
  if (reviews.length !== items.length) {
    reviews.push(...fallbackReviews(items.filter((item) => !seen.has(item.candidate.id))));
  }
  return reviews;
}

function changedFileList(context: PRContext): string {
  return context.files
    .slice(0, 40)
    .map((file) => `- ${file.path} (${file.status}, +${file.additions}/-${file.deletions}${file.previousPath ? `, from ${file.previousPath}` : ""})`)
    .join("\n");
}

function findingsDigest(items: AstraInput[], reviews: AstraReview[]): string {
  if (items.length === 0) return "No confirmed findings.";
  const byId = new Map(reviews.map((review) => [review.candidateId, review]));
  return items
    .map((item) => {
      const review = byId.get(item.candidate.id);
      return `- ${item.candidate.id} [${item.candidate.severity}] ${item.candidate.claim.slice(0, 220)} — proof ${item.proof.status}, repair ${item.repair?.exit ?? "not attempted"}, verification ${item.verification ? (item.verification.passed ? "passed" : "failed") : "none"}, reviewer ${review ? `${review.approval}/${review.fixCorrectness} (${review.confidence})` : "n/a"}`;
    })
    .join("\n");
}

function reportWalkthroughCount(report: FinalReviewReport): number {
  return report.walkthrough.length;
}

async function synthesizeReport(
  input: FinalReviewInput,
  items: AstraInput[],
  reviews: AstraReview[],
  models: ModelRouter,
  logger: Logger,
): Promise<FinalReviewReport> {
  const learnings = renderLearnings(input.learnings);
  const diff = truncate(renderCompactDiff(input.context.files, { maxChars: 24_000, contextLines: 6 }), 24_000);
  const symbols = input.context.symbols.slice(0, 30).map((symbol) => `${symbol.kind} ${symbol.name} (${symbol.file}:${symbol.line})`);
  const unproven = unprovenDigest(input);
  const response = await models.complete({
    role: "astra",
    kind: "final_review_report",
    system: REPORT_SYSTEM,
    user: [
      `# Pull request`,
      `Title: ${input.context.title}`,
      `Body: ${truncate(input.context.body || "(empty)", 1_500)}`,
      `Classification: ${input.context.classification.join(", ") || "general"} | Size: ${input.context.size} | +${input.context.additions}/-${input.context.deletions}`,
      `Changed files:\n${changedFileList(input.context)}`,
      symbols.length > 0 ? `Changed symbols:\n- ${symbols.join("\n- ")}` : "",
      `# Diff\n${diff || "(diff unavailable)"}`,
      `# Confirmed findings\n${findingsDigest(items, reviews)}`,
      unproven ? `# Unproven / static-only candidates\n${unproven}` : "",
      input.instructions ? `Reviewer instructions (follow these):\n${truncate(input.instructions, 1_500)}` : "",
      learnings ? `Repository learnings (follow these):\n${learnings}` : "",
      "Return the PR review JSON now.",
    ]
      .filter(Boolean)
      .join("\n\n"),
    expectJson: true,
    maxTokens: 8_000,
    signal: input.signal,
    label: "astra-report",
  });
  const parsed = reportSchema.safeParse(extractJson(response.text));
  if (!parsed.success) throw new Error(`invalid astra report JSON: ${parsed.error.message.slice(0, 200)}`);
  const data = parsed.data;
  const report: FinalReviewReport = {
    verdict: {
      decision: data.verdict.decision,
      confidence: data.verdict.confidence,
      rationale: truncate(data.verdict.rationale, 2_000),
    },
    summary: truncate(data.summary, 2_000),
    walkthrough: data.walkthrough.map((entry) => ({
      file: entry.file,
      intent: truncate(entry.intent, 400),
      changeSummary: truncate(entry.changeSummary, 800),
      risk: entry.risk,
      notes: entry.notes ? truncate(entry.notes, 400) : undefined,
    })),
    risks: data.risks.map((risk) => ({
      area: truncate(risk.area, 200),
      severity: risk.severity,
      rationale: truncate(risk.rationale, 800),
      mitigation: risk.mitigation ? truncate(risk.mitigation, 400) : undefined,
    })),
    testCoverage: {
      assessed: data.testCoverage.assessed,
      signals: data.testCoverage.signals.map((signal) => truncate(signal, 240)),
      gaps: data.testCoverage.gaps.map((gap) => truncate(gap, 240)),
    },
    observations: data.observations.map((observation) => ({ kind: truncate(observation.kind, 80), detail: truncate(observation.detail, 600) })),
    limitations: data.limitations.map((limitation) => truncate(limitation, 400)),
    findingsSummary: findingsSummary(items, input),
    source: "model",
  };
  if (reportWalkthroughCount(report) === 0) {
    logger.warn("astra report had an empty walkthrough");
  }
  return report;
}

/**
 * 3.3 final review: per-finding deep reviews plus a full PR-level report.
 * Failures degrade to deterministic output for only the failed part, so a
 * report failure never discards model-authored per-finding reviews.
 */
export async function finalReview(input: FinalReviewInput, models: ModelRouter, logger: Logger): Promise<FinalReviewOutcome> {
  const { items } = input;
  let reviews: AstraReview[];
  let report: FinalReviewReport;

  if (items.length > 0) {
    try {
      reviews = await reviewFindings(items, models, input);
    } catch (error) {
      logger.warn("astra per-finding review fell back to deterministic review", { error: error instanceof Error ? error.message : String(error) });
      reviews = fallbackReviews(items);
    }
  } else {
    reviews = [];
  }

  try {
    report = await synthesizeReport(input, items, reviews, models, logger);
  } catch (error) {
    logger.warn("astra PR report fell back to deterministic report", { error: error instanceof Error ? error.message : String(error) });
    report = fallbackReport(input, error instanceof Error ? error.message.slice(0, 200) : String(error));
  }

  return { reviews, report: applyVerdictGuardrails(report, items) };
}
