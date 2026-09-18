import assert from "node:assert/strict";
import test from "node:test";
import { buildReviewComment, CODEBOT_MARKER, REVIEW_MARKER } from "../src/markdown.ts";
import type {
  FixReport,
  GeneratedFix,
  Hypothesis,
  HypothesisReport,
  VerifyAttempt,
  VerifiedFix,
  VerifyReport,
} from "../src/types.ts";

function hypothesis(overrides: Partial<Hypothesis> = {}): Hypothesis {
  return {
    id: "s_abc123",
    ruleId: "threshold-change",
    source: "rule",
    mechanism: "wrong-value",
    severity: "high",
    confidence: 0.7,
    file: "client/src/pages/Usage.tsx",
    line: 28,
    snippet: "const days = period === '7d' ? 30 : 7;",
    change: "the 7d/30d mapping was swapped",
    why: "the dashboard shows the wrong window",
    question: "which control maps to which day count?",
    downstream: [],
    priority: 1,
    ...overrides,
  };
}

function fixReport(fixes: GeneratedFix[]): FixReport {
  return {
    repository: "acme/app",
    pullRequestNumber: 7,
    headSha: "74c5449d",
    fixes,
    totals: {
      available: fixes.length,
      hypotheses: fixes.length,
      generated: fixes.filter((fix) => fix.outcome === "generated").length,
      notFixable: 0,
      refused: 0,
      failed: 0,
      failedTransport: 0,
      skipped: 0,
      planOnly: 0,
    },
    usage: {
      coordinator: { id: "terra", calls: 1, tokensIn: 10, tokensOut: 5, cachedTokensIn: 0, costUsd: 0.01, failedCalls: 0 },
      swarm: { id: "luna", calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, failedCalls: 0 },
      codegen: { id: "sol", calls: 1, tokensIn: 10, tokensOut: 5, cachedTokensIn: 0, costUsd: 0.02, failedCalls: 0 },
      totalCostUsd: 0.03,
      maxCostUsd: 0.5,
      used: true,
    },
    suggestions: { posted: 0, skipped: 0 },
    warnings: [],
  };
}

function hypothesisReport(hypotheses: Hypothesis[]): HypothesisReport {
  return {
    repository: "acme/app",
    pullRequestNumber: 7,
    headSha: "74c5449d",
    indexCommitSha: null,
    hypotheses,
    totals: { hypotheses: hypotheses.length, critical: 0, high: hypotheses.length, medium: 0, low: 0 },
    usage: fixReport([]).usage,
    dismissed: 0,
    deduped: 0,
    warnings: ["a stage warning"],
  };
}

const attempt: VerifyAttempt = {
  attempt: 1,
  kind: "initial",
  status: "passed",
  edits: [],
  applyErrors: [],
  runs: [{ cmd: "node probe.mjs", why: "reproduce", exitCode: 0, timedOut: false, durationMs: 100, stdoutTail: "ok", stderrTail: "" }],
  preExisting: [],
  reproductions: 1,
  durationMs: 120,
};

function verifiedFix(hypothesis: Hypothesis, overrides: Partial<VerifiedFix> = {}): VerifiedFix {
  return {
    hypothesisId: hypothesis.id,
    priority: hypothesis.priority ?? 1,
    severity: hypothesis.severity,
    hypothesis,
    edits: [
      {
        path: hypothesis.file,
        find: "const days = period === '7d' ? 30 : 7;",
        replace: "const days = period === '7d' ? 7 : 30;",
        outsideDiff: false,
        startLine: 28,
        endLine: 28,
        inDiff: true,
      },
    ],
    status: "verified",
    evidence: "reproduction",
    attemptsUsed: 1,
    attempts: [attempt],
    sandboxId: "sbx-test",
    durationMs: 2_000,
    ...overrides,
  };
}

function verifyReport(fixes: VerifiedFix[]): VerifyReport {
  return {
    repository: "acme/app",
    pullRequestNumber: 7,
    headSha: "74c5449d",
    fixes,
    totals: {
      available: fixes.length,
      eligible: fixes.length,
      verified: fixes.filter((fix) => fix.status === "verified").length,
      unverified: fixes.filter((fix) => fix.status === "unverified").length,
      skipped: 0,
      inconclusive: 0,
      reproductions: fixes.filter((fix) => fix.evidence === "reproduction").length,
      attempts: fixes.reduce((total, fix) => total + fix.attempts.length, 0),
      commands: 1,
    },
    sandbox: { id: "sbx-test", template: "test-template", created: true, cloneMs: 1_000, installMs: 2_000 },
    usage: fixReport([]).usage,
    suggestions: { posted: 1, skipped: 0, removed: 0 },
    warnings: [],
  };
}

test("buildReviewComment is one review with findings, fixes and a collapsed log", () => {
  const finding = hypothesis();
  const verified = verifiedFix(finding);
  const skipped = hypothesis({ id: "s_low", priority: 2, severity: "low", mechanism: "stale-state" });
  const body = buildReviewComment({
    hypothesisReport: hypothesisReport([finding, skipped]),
    fixReport: fixReport([
      {
        hypothesisId: finding.id,
        priority: 1,
        hypothesis: finding,
        edits: verified.edits,
        summary: "swap the mapping back",
        confidence: 0.8,
        attempts: 1,
        outcome: "generated",
      },
      {
        hypothesisId: skipped.id,
        priority: 2,
        hypothesis: skipped,
        edits: [],
        summary: "",
        confidence: 0,
        attempts: 0,
        outcome: "not_fixable",
        reason: "needs a product decision",
      },
    ]),
    verifyReport: verifyReport([verified]),
    runId: "codebot-test",
    version: "0.4.0",
  });

  assert.ok(body.startsWith(REVIEW_MARKER));
  assert.ok(body.includes(CODEBOT_MARKER));
  assert.ok(body.includes("## CodeBot review"));
  assert.ok(body.includes("2 finding(s) · 1 critical/high · 1 priority fix(es) drafted · 1/1 verified in a sandbox"));
  assert.ok(body.includes("### Findings"));
  assert.ok(body.includes("**verified in sandbox**"));
  assert.ok(body.includes("inline suggestion"));
  assert.ok(body.includes("**not fixable** — needs a product decision"));
  assert.ok(body.includes("### Verified fixes"));
  assert.ok(body.includes("### Verification detail"));
  assert.ok(body.includes("<details><summary>Sandbox verification log"));
  assert.ok(body.includes("node probe.mjs"));
  assert.ok(body.includes("a stage warning"));
  assert.ok(body.includes("_Total $0.0300 of $0.50 budget"));
  assert.ok(!body.includes("codegraph"), "the review never exposes the internal codegraph stage");
});

test("buildReviewComment reports verified out-of-diff edits with their patch", () => {
  const finding = hypothesis();
  const verified = verifiedFix(finding, {
    edits: [
      {
        path: "client/src/pages/ApiKeys.tsx",
        find: "sessionStorage.setItem('k', raw.substring(0, 10));",
        replace: "sessionStorage.setItem('k', raw);",
        outsideDiff: true,
        startLine: 90,
        endLine: 90,
        inDiff: false,
      },
    ],
  });
  const body = buildReviewComment({
    fixReport: fixReport([
      {
        hypothesisId: finding.id,
        priority: 1,
        hypothesis: finding,
        edits: verified.edits,
        summary: "store the full key",
        confidence: 0.8,
        attempts: 1,
        outcome: "generated",
      },
    ]),
    verifyReport: verifyReport([verified]),
    runId: "codebot-test",
    version: "0.4.0",
  });

  assert.ok(body.includes("no inline suggestion (edits outside the diff)"));
  assert.ok(body.includes("**Verified edits outside the diff**"));
  assert.ok(body.includes("+++ b/client/src/pages/ApiKeys.tsx") || body.includes("--- a/client/src/pages/ApiKeys.tsx"));
});

test("buildReviewComment survives a hypotheses-only report without fixes", () => {
  const body = buildReviewComment({
    hypothesisReport: hypothesisReport([hypothesis()]),
    runId: "codebot-test",
    version: "0.4.0",
  });
  assert.ok(body.includes("### Findings"));
  assert.ok(body.includes("**Fix:** no fix planned"));
  assert.ok(!body.includes("### Verified fixes"));
  assert.ok(body.includes("## CodeBot review"));
});

test("buildReviewComment explains findings below the priority severities", () => {
  const body = buildReviewComment({
    hypothesisReport: hypothesisReport([hypothesis({ severity: "low" })]),
    severities: ["critical", "high"],
    runId: "codebot-test",
    version: "0.4.0",
  });
  assert.ok(body.includes("not a priority severity (critical/high) — not fixed"));
});
