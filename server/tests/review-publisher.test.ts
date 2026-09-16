import assert from "node:assert/strict";
import { test } from "node:test";
import type { CandidateRecord, EngineResult, Finding } from "../../cortardobot/src/types.ts";
import { parseChangedFiles } from "../../cortardobot/src/patch.ts";
import { ENGINE_VERSION } from "../../cortardobot/src/version.ts";
import {
  buildCheckRunText,
  buildInlineComments,
  buildReviewBody,
  decideCheckConclusion,
  decideReviewEvent,
  selectSupersededBotReviews,
  shouldDismissBotReview,
} from "../lib/review/publisher";

const CONTENT = ["const a = 1;", "const x = undefined;", "export default a;"].join("\n");
const PATCH = "@@ -1,3 +1,3 @@\n const a = 1;\n-const x = undefined;\n+const x = 1;\n export default a;";

function verifiedFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "c_1",
    claim: "x is dereferenced while undefined",
    severity: "high",
    confidence: 0.9,
    file: "src/a.ts",
    line: 2,
    evidence: ["src/a.ts:2"],
    state: "verified_fix",
    repro: {
      artifact: { path: "repro.mjs", command: "node .cortado-probes/repro.mjs", content: "throw new Error('x is undefined')", hash: "h1", failures: 2 },
      explanation: "the reproduction fails twice and names the file",
      output: "Error: x is undefined at src/a.ts",
    },
    fix: {
      state: "verified",
      reason: "reproduction passes and gates pass; verified on a clean replay",
      patch: PATCH,
      edits: [{ path: "src/a.ts", find: "const x = undefined;", replace: "const x = 1;" }],
      attempts: [],
      verification: { passed: true, steps: [{ kind: "repro_1", passed: true, reason: "passes on the clean replay" }] },
      reviewer: { approved: true, risk: "low", confidence: 0.9, summary: "the patch addresses the claimed cause" },
    },
    ...overrides,
  };
}

function failedFinding(): Finding {
  return verifiedFinding({
    id: "c_2",
    state: "fix_failed",
    fix: { state: "failed", reason: "repair failed: repro_still_fails", attempts: [] },
  });
}

function result(overrides: Partial<EngineResult> = {}): EngineResult {
  const findings = overrides.findings ?? [verifiedFinding()];
  const candidates: CandidateRecord[] =
    overrides.candidates ??
    findings.map((finding) => ({
      candidateId: finding.id,
      claim: finding.claim,
      severity: finding.severity,
      file: finding.file,
      state: finding.state,
      reason: finding.fix?.reason ?? finding.repro.explanation,
    }));
  return {
    runId: "run-1",
    status: "done",
    degraded: false,
    pr: { classification: ["UI"], size: "small" },
    files: parseChangedFiles([{ path: "src/a.ts", status: "modified", patch: PATCH, content: CONTENT, additions: 1, deletions: 1 }]),
    candidates,
    findings,
    summary: {
      issuesFound: candidates.length,
      issuesConfirmed: findings.length,
      issuesReproduced: findings.length,
      issuesFixed: findings.filter((finding) => finding.state === "verified_fix").length,
      issuesVerified: findings.filter((finding) => finding.state === "verified_fix").length,
      staticOnly: candidates.filter((entry) => entry.state === "not_reproduced").length,
      deferred: 0,
      errors: 0,
      durationMs: 12_000,
      modelCalls: 9,
      costUsd: 0.12,
    },
    report: {
      verdict: { decision: findings.some((finding) => finding.state !== "verified_fix") ? "request_changes" : "approve", confidence: 0.9, rationale: "Because the reproduction says so." },
      summary: "A summary.",
      reproduced: findings.map((finding) => ({ id: finding.id, claim: finding.claim, severity: finding.severity, file: finding.file, line: finding.line })),
      verified: [],
      unresolved: [],
      coverage: candidates.map((entry) => ({ id: entry.candidateId, claim: entry.claim, severity: entry.severity, state: entry.state, reason: entry.reason })),
    },
    models: { investigator: "openai/gpt-5.6-luna", engineer: "openai/gpt-6-astra", reviewer: "openai/gpt-5.6-sol", reasoning: { investigator: "medium", engineer: "high", reviewer: "high" } },
    usage: { calls: 9, byRole: {}, tokensIn: 100, tokensOut: 100, cachedTokensIn: 0, costUsd: 0.12, modelMs: 1 },
    timings: {},
    events: [],
    ...overrides,
  };
}

test("the engine version is 3.5.0", () => {
  assert.equal(ENGINE_VERSION, "3.5.0");
});

test("the review body reports reproductions, verification and coverage", () => {
  const body = buildReviewBody(result());
  assert.match(body, /## Cortado Review/);
  assert.match(body, /1 issue\(s\) reproduced/);
  assert.match(body, /\*\*1 fixed and verified\*\*/);
  assert.match(body, /### Coverage/);
  assert.match(body, /openai\/gpt-5\.6-luna/);
  assert.match(body, /repro\.mjs/);
  assert.match(body, /Independent reviewer.*approved/);
  assert.match(body, /engine 3\.5\.0/);
  assert.doesNotMatch(body, /apiKey|baseUrl/);
});

test("a degraded run is labelled in the body", () => {
  const body = buildReviewBody(result({ degraded: true, degradedReason: "1 candidate(s) deferred by budget" }));
  assert.match(body, /Degraded run: 1 candidate\(s\) deferred by budget/);
});

test("verified findings publish an inline suggestion, others publish evidence", () => {
  const findings = [verifiedFinding(), failedFinding()];
  const comments = buildInlineComments(result({ findings, candidates: [], }));
  assert.equal(comments.length, 2);
  const [first, second] = comments;
  assert.match(first.body, /Cortado verified fix/);
  assert.match(first.body, /```suggestion/);
  assert.equal(first.line, 2);
  assert.equal(first.start_line, 2);
  assert.match(second.body, /Cortado finding \(reproduced\)/);
  assert.match(second.body, /Fix status: \*\*reproduced, fix failed\*\*/);
});

test("unproven high/medium candidates appear as labelled advisories", () => {
  const candidate: CandidateRecord = {
    candidateId: "c_unproven",
    claim: "Usage inverts the 7d/30d ranges",
    severity: "medium",
    file: "src/a.ts",
    state: "not_reproduced",
    reason: "no executable reproduction was produced",
  };
  const comments = buildInlineComments(result({ findings: [], candidates: [candidate] }));
  assert.equal(comments.length, 1);
  assert.match(comments[0].body, /Cortado advisory \(not reproduced\)/);
  assert.match(comments[0].body, /neither confirmed nor fixed/);
});

test("review events follow the reproduction evidence", () => {
  assert.equal(decideReviewEvent(result()), "COMMENT");
  assert.equal(decideReviewEvent(result({ findings: [] })), "APPROVE");
  assert.equal(decideReviewEvent(result({ findings: [failedFinding()] })), "REQUEST_CHANGES");
  assert.equal(
    decideReviewEvent(
      result({
        findings: [],
        degraded: true,
        candidates: [{ candidateId: "c_x", claim: "errored", severity: "medium", file: "src/a.ts", state: "error", reason: "sandbox unavailable" }],
      }),
    ),
    "COMMENT",
  );
});

test("check conclusions never go green on a degraded or blocking run", () => {
  assert.equal(decideCheckConclusion(result()), "success");
  assert.equal(decideCheckConclusion(result({ findings: [failedFinding()] })), "failure");
  assert.equal(decideCheckConclusion(result({ findings: [], degraded: true })), "neutral");
  assert.equal(
    decideCheckConclusion(
      result({
        findings: [],
        candidates: [{ candidateId: "c_unproven", claim: "unproven", severity: "medium", file: "src/a.ts", state: "not_reproduced", reason: "n/a" }],
        summary: { ...result().summary, staticOnly: 1 },
      }),
    ),
    "neutral",
  );
});

test("the check run text carries the verdict and coverage", () => {
  const text = buildCheckRunText(result());
  assert.match(text ?? "", /## Verdict: approve/);
  assert.match(text ?? "", /### Coverage/);
});

test("runtime regressions block but pre-existing ones do not", () => {
  const regression = verifiedFinding({
    id: "c_rt",
    state: "reproduced",
    fix: undefined,
    runtime: { surface: "ui", preExisting: false, baseReason: "passes on the base revision" },
  });
  const preExisting = verifiedFinding({
    id: "c_pre",
    state: "reproduced",
    fix: undefined,
    runtime: { surface: "api", preExisting: true, baseReason: "also fails on the base revision" },
  });
  const regressionResult = result({ findings: [regression], candidates: [] });
  assert.equal(decideReviewEvent(regressionResult), "REQUEST_CHANGES");
  assert.equal(decideCheckConclusion(regressionResult), "failure");

  const preResult = result({
    findings: [preExisting],
    candidates: [],
    report: { ...result().report, verdict: { decision: "approve_with_comments", confidence: 0.8, rationale: "pre-existing issue" } },
  });
  assert.equal(decideReviewEvent(preResult), "COMMENT");
  assert.equal(decideCheckConclusion(preResult), "neutral");
  assert.match(buildReviewBody(preResult), /pre-existing runtime/);
});

test("the review body records the runtime exercise result", () => {
  const exercised = buildReviewBody(result({ report: { ...result().report, runtime: { status: "exercised", surfaces: ["ui", "api"] } } }));
  assert.match(exercised, /Runtime exercise: exercised \(ui, api\)/);
  const skipped = buildReviewBody(result({ report: { ...result().report, runtime: { status: "skipped", surfaces: [], reason: "no runnable surface" } } }));
  assert.match(skipped, /Runtime exercise: not run — no runnable surface/);
});

test("only the bot's dismissable reviews for this commit are superseded", () => {
  const review = {
    id: 1,
    state: "CHANGES_REQUESTED",
    commitId: "head",
    body: "## Cortado Review\n...",
    userType: "Bot",
    userLogin: "cortardobot[bot]",
  };
  assert.equal(shouldDismissBotReview(review, "head"), true);
  assert.equal(shouldDismissBotReview(review, "other"), false);
  assert.equal(shouldDismissBotReview({ ...review, state: "COMMENTED" }, "head"), false);
  assert.equal(shouldDismissBotReview({ ...review, body: "human review" }, "head"), false);
  assert.equal(selectSupersededBotReviews([review, { ...review, id: 2 }], "head", 2).length, 1);
});
