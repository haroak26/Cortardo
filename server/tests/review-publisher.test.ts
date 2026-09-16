import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding, ReviewResult } from "../../cortardobot/src/v3/types.ts";
import { buildCheckRunText, buildInlineComments, buildReviewBody, decideCheckConclusion, decideReviewEvent, selectSupersededBotReviews, shouldDismissBotReview } from "../lib/review/publisher";
import { ENGINE_VERSION } from "../../cortardobot/src/v3/version";

const CONTENT = ["const a = 1;", "const x = undefined;", "export default a;"].join("\n");

function parsedFile() {
  return {
    path: "src/a.ts",
    status: "modified" as const,
    language: "TypeScript",
    additions: 1,
    deletions: 1,
    content: CONTENT,
    lines: CONTENT.split("\n"),
    addedLines: [{ type: "+" as const, text: "const x = undefined;", newLine: 2 }],
    removedLines: [],
    hunks: [
      {
        oldStart: 1,
        oldLines: 3,
        newStart: 1,
        newLines: 3,
        header: "",
        lines: [
          { type: " " as const, text: "const a = 1;", oldLine: 1, newLine: 1 },
          { type: "+" as const, text: "const x = undefined;", newLine: 2 },
          { type: " " as const, text: "export default a;", oldLine: 3, newLine: 3 },
        ],
      },
    ],
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  const candidate = {
    id: "c_1",
    claim: "src/a.ts declares x as undefined",
    severity: "high" as const,
    confidence: 0.9,
    file: "src/a.ts",
    line: 2,
    evidence: ["src/a.ts:2"],
    source: "detector" as const,
    agentKind: "runtime" as const,
    suggestedProof: "browser" as const,
    tags: ["test"],
    occurrences: 1,
    score: 5,
    mergedFrom: [],
  };
  return {
    candidate,
    proof: {
      candidateId: "c_1",
      status: "confirmed",
      strategy: "browser",
      attempts: [],
      reproduction: "page must render: assertion failed (expected pass) at http://127.0.0.1:4173/docs",
      explanation: "Reproduced in a real browser: assertion failed (expected pass)",
      durationMs: 10,
    },
    repair: {
      candidateId: "c_1",
      severity: "high",
      exit: "VERIFIED",
      attempts: [],
      finalPatch: "--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,3 +1,3 @@\n const a = 1;\n-const x = undefined;\n+const x = 1;",
      finalEdits: [{ path: "src/a.ts", find: "const x = undefined;", replace: "const x = 1;" }],
      durationMs: 10,
      toolCalls: 1,
      reason: "fix applied and the reproduction passes after 1 attempt(s)",
    },
    verification: {
      passed: true,
      durationMs: 10,
      steps: [
        { kind: "reproduction", command: "playwright check", passed: true, skipped: false, reason: "Reproduction passes twice on a fresh boot", durationMs: 5 },
        { kind: "typecheck", command: "npx tsc --noEmit", passed: true, skipped: false, reason: "type-check", durationMs: 5 },
      ],
    },
    ...overrides,
  };
}

function result(findings: Finding[], overrides: Partial<ReviewResult> = {}): ReviewResult {
  const models = {
    luna: "openai/gpt-5.6-luna",
    terra: "openai/gpt-5.6-terra",
    codegen: "openai/gpt-6-astra",
    astra: "openai/gpt-5.6-sol",
    reasoning: { luna: "medium", terra: "high", codegen: "high", astra: "high" },
  } as ReviewResult["models"];
  return {
    runId: "run_1",
    status: "completed",
    pr: { id: "run_1", title: "Test", classification: ["UI"], size: "normal" },
    context: { files: [parsedFile()] } as unknown as ReviewResult["context"],
    candidates: findings.map((f) => f.candidate),
    decisions: [],
    proofs: findings.map((f) => f.proof),
    repairs: findings.map((f) => f.repair!).filter(Boolean),
    verifications: {},
    findings,
    reviews: [],
    events: [],
    timings: {},
    usage: { calls: 2, byRole: {}, tokensIn: 10, tokensOut: 10, cachedTokensIn: 0, costUsd: 0.01, modelMs: 5 },
    models,
    cache: { hits: 1, misses: 2, writes: 1, byKind: {}, creditsSavedUsd: 0.001 },
    summary: {
      issuesFound: 1,
      issuesConfirmed: 1,
      issuesFixed: 1,
      issuesVerified: 1,
      staticOnly: 0,
      discarded: 0,
      durationMs: 1_000,
      modelCalls: 2,
      costUsd: 0.01,
      cacheHits: 1,
      cacheMisses: 2,
      creditsSavedUsd: 0.001,
      maxAttempts: 1,
    },
    markdown: "",
    ...overrides,
  };
}

test("verified fixes publish a suggestion at the exact diff range with post-fix evidence", () => {
  const comments = buildInlineComments(result([finding()]));
  assert.equal(comments.length, 1);
  const comment = comments[0] as { body: string; line: number; start_line?: number };
  assert.equal(comment.line, 2);
  assert.equal(comment.start_line, 2);
  assert.match(comment.body, /Cortado verified fix/);
  assert.match(comment.body, /```suggestion\nconst x = 1;\n```/);
  assert.match(comment.body, /Fix verification: passed|pass · reproduction/);
  assert.ok(!/suggestion/.test(comment.body) || !comment.body.includes("assertion failed (expected pass) at http://127.0.0.1:4173/docs\n```suggestion"), "must not pair a failing assertion with a suggestion");
});

test("a verified repair without patch hunks never publishes a suggestion", () => {
  const broken = finding({ repair: { ...finding().repair!, finalPatch: "--- a/src/a.ts\n+++ b/src/a.ts" } });
  const comments = buildInlineComments(result([broken]));
  assert.equal(comments.length, 1);
  const body = (comments[0] as { body: string }).body;
  assert.ok(!body.includes("```suggestion"));
  assert.match(body, /Cortado finding/);
});

test("review body shows honest status, models and pre-fix reproduction label", () => {
  const body = buildReviewBody(result([finding()]));
  assert.match(body, /1 fixed and verified/);
  assert.match(body, /openai\/gpt-6-astra/);
  assert.match(body, /Defect reproduction \(pre-fix, browser\)/);
  assert.match(body, /Fix verification:\*\* passed/);
  assert.match(body, /const x = 1;/);
});

test("an unresolved high finding requests changes and fails the check", () => {
  const unresolved = finding({
    repair: { ...finding().repair!, exit: "UNRESOLVED", finalPatch: undefined, reason: "fix not verified within 2 attempt(s)" },
    verification: { passed: false, durationMs: 5, steps: [{ kind: "reproduction", command: "check", passed: false, skipped: false, reason: "defect still reproduces", durationMs: 5 }] },
  });
  const value = result([unresolved], { summary: { ...result([]).summary, issuesVerified: 0 } });
  assert.equal(decideReviewEvent(value), "REQUEST_CHANGES");
  assert.equal(decideCheckConclusion(value), "failure");
  const body = buildReviewBody(value);
  assert.match(body, /No patch was produced|Repair: UNRESOLVED/);
});

test("a degraded run never reports a green check", () => {
  const value = result([finding()], { degraded: true, degradedReason: "verify skipped" });
  assert.equal(decideCheckConclusion(value), "neutral");
});

test("review footer reports the engine version and swarm telemetry", () => {
  const value = result([finding()], {
    swarm: {
      mode: "agentic",
      agents: [{ id: "luna-bug", kind: "bug", title: "Bug investigator", status: "completed", turns: 2, toolCalls: 3, hypotheses: 1, candidates: 1, durationMs: 5 }],
      hypotheses: 1,
      candidates: 1,
      durationMs: 5,
    },
  });
  const body = buildReviewBody(value);
  assert.match(body, new RegExp(`engine ${ENGINE_VERSION.replace(/\./g, "\\.")}`));
  assert.match(body, /Swarm: agentic, 1 agent\(s\), 1 hypothesis\(es\), 1 candidate\(s\)/);
});

function report(overrides: Partial<NonNullable<ReviewResult["reviewReport"]>> = {}): NonNullable<ReviewResult["reviewReport"]> {
  return {
    verdict: { decision: "approve_with_comments", confidence: 0.82, rationale: "All confirmed defects are fixed and verified, but the pricing copy deserves a second look." },
    summary: "Three runtime defects were reproduced in a browser and fixed; the diff is otherwise low risk.",
    walkthrough: [{ file: "src/a.ts", intent: "remove the undefined dereference", changeSummary: "guard the value", risk: "low" }],
    risks: [{ area: "pricing copy", severity: "low", rationale: "the copy changed", mitigation: "review the wording" }],
    testCoverage: { assessed: true, signals: ["browser check for /docs"], gaps: ["no unit test for the pricing filter"] },
    observations: [{ kind: "refactor", detail: "the tiers map is now keyed by id" }],
    limitations: ["the sandbox covered Chrome only"],
    findingsSummary: { confirmed: 1, verified: 1, unresolved: 0, staticOnly: 0, discarded: 0 },
    source: "model",
    ...overrides,
  };
}

test("the full PR report renders verdict, walkthrough, risks, coverage and limitations", () => {
  const value = result([finding()], { reviewReport: report() });
  const body = buildReviewBody(value);
  assert.match(body, /Final verdict: \*\*APPROVE WITH COMMENTS\*\* · confidence 82%/);
  assert.match(body, /### Walkthrough/);
  assert.match(body, /### Risks/);
  assert.match(body, /### Test coverage/);
  assert.match(body, /### Limitations/);
  assert.match(body, /openai\/gpt-5\.6-sol/);
  const text = buildCheckRunText(value);
  assert.ok(text);
  assert.match(text!, /Verdict: approve with comments/);
  assert.match(text!, /pricing copy/);
});

test("a fallback report is labelled and can never approve", () => {
  const value = result([], {
    reviewReport: report({ verdict: { decision: "approve", confidence: 0.5, rationale: "fallback" }, source: "fallback", walkthrough: [] }),
  });
  assert.equal(decideReviewEvent(value), "COMMENT");
  assert.match(buildReviewBody(value), /deterministic fallback/);
});

test("the reviewer verdict drives the event and check behind guardrails", () => {
  const clean = result([], { reviewReport: report({ verdict: { decision: "approve", confidence: 0.95, rationale: "clean" } }) });
  assert.equal(decideReviewEvent(clean), "APPROVE");
  assert.equal(decideCheckConclusion(clean), "success");

  const changes = result([], { reviewReport: report({ verdict: { decision: "request_changes", confidence: 0.9, rationale: "risky" } }) });
  assert.equal(decideReviewEvent(changes), "REQUEST_CHANGES");
  assert.equal(decideCheckConclusion(changes), "neutral");

  const verifiedButConcerned = result([finding()], { reviewReport: report({ verdict: { decision: "request_changes", confidence: 0.7, rationale: "concern" } }) });
  assert.equal(decideReviewEvent(verifiedButConcerned), "REQUEST_CHANGES");
  assert.equal(decideCheckConclusion(verifiedButConcerned), "neutral");
});

test("an oversized review body is truncated with an explicit notice", () => {
  const huge = result([finding()], {
    reviewReport: report({ summary: "x".repeat(70_000) }),
  });
  const body = buildReviewBody(huge);
  assert.ok(body.length <= 60_000);
  assert.match(body, /Review truncated at/);
});

test("only dismissable bot review states are selected for dismissal", () => {
  const base = { commitId: "sha", body: "## Cortado Review\n…", userType: "Bot", userLogin: "cortado[bot]" };
  assert.equal(shouldDismissBotReview({ ...base, state: "COMMENTED" }, "sha"), false);
  assert.equal(shouldDismissBotReview({ ...base, state: "DISMISSED" }, "sha"), false);
  assert.equal(shouldDismissBotReview({ ...base, state: "APPROVED" }, "sha"), true);
  assert.equal(shouldDismissBotReview({ ...base, state: "CHANGES_REQUESTED" }, "sha"), true);
  assert.equal(shouldDismissBotReview({ ...base, state: "APPROVED", commitId: "other" }, "sha"), false);
  assert.equal(shouldDismissBotReview({ ...base, state: "APPROVED", userType: "User", userLogin: "human" }, "sha"), false);
});

test("a freshly created review is never selected for dismissal", () => {
  const base = { state: "CHANGES_REQUESTED", commitId: "sha", body: "## Cortado Review\n…", userType: "Bot", userLogin: "cortardobot[bot]" };
  const previous = { ...base, id: 1 };
  const fresh = { ...base, id: 2 };
  assert.deepEqual(
    selectSupersededBotReviews([previous, fresh], "sha", 2).map((review) => review.id),
    [1],
    "the new review must survive its own publish",
  );
  assert.deepEqual(selectSupersededBotReviews([previous, fresh], "sha").map((review) => review.id), [1, 2]);
  assert.deepEqual(selectSupersededBotReviews([fresh], "sha", 2), []);
  assert.deepEqual(selectSupersededBotReviews([{ ...previous, state: "COMMENTED" }], "sha", 2), []);
});

test("static-only high findings publish labelled non-blocking comments", () => {
  const staticCandidate = {
    ...finding().candidate,
    id: "c_static",
    source: "luna" as const,
    suggestedProof: "none" as const,
    check: undefined,
    suggestedExperiment: "assert the 7d period requests 7 days",
  };
  const value = result([], {
    candidates: [staticCandidate],
    decisions: [{ candidateId: staticCandidate.id, verdict: "STATIC_ONLY", reason: "the prover could not reproduce it", priority: 90 }],
  });
  const comments = buildInlineComments(value);
  assert.equal(comments.length, 1);
  const body = (comments[0] as { body: string }).body;
  assert.match(body, /static finding \(unproven\)/);
  assert.match(body, /neither confirmed nor fixed/);
  assert.match(body, /assert the 7d period/);
  // Static findings never block on their own.
  assert.equal(decideReviewEvent(value), "COMMENT");
  assert.equal(decideCheckConclusion(value), "neutral");
});

test("proof coverage is rendered in the review body and check text", () => {
  const unproven = { ...finding().candidate, id: "c_unproven", source: "luna" as const, suggestedProof: "none" as const, check: undefined };
  const value = result([], {
    candidates: [unproven],
    decisions: [{ candidateId: unproven.id, verdict: "PROVE", reason: "material", priority: 1 }],
    loop: {
      judgeProve: 1,
      proven: 0,
      proofUnavailable: 1,
      proofErrors: 0,
      candidates: [{ candidateId: unproven.id, severity: "high", proofState: "UNPROVABLE", reason: "no executable reproduction was produced" }],
    },
    degraded: true,
    degradedReason: "judge approved 1 candidate(s); 0 proven, 1 unprovable",
    reviewReport: report(),
  });
  const body = buildReviewBody(value);
  assert.match(body, /### Proof coverage/);
  assert.match(body, /Judge approved 1 candidate\(s\)/);
  assert.match(body, /unprovable: no executable reproduction/);
  const text = buildCheckRunText(value);
  assert.ok(text);
  assert.match(text!, /Proof coverage/);
  assert.match(text!, /Judge approved 1 candidate/);
  assert.equal(decideCheckConclusion(value), "neutral");
});
