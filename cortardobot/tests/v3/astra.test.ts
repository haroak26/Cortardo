import assert from "node:assert/strict";
import { test } from "node:test";
import { applyVerdictGuardrails, fallbackReport, finalReview, type AstraInput } from "../../src/v3/astra.ts";
import { ModelRouter, ModelError } from "../../src/v3/models.ts";
import { resolveV3Config } from "../../src/v3/config.ts";
import { candidate, contextWith, proof, scriptedClient, silentLogger } from "./helpers.ts";
import type { FinalReviewReport } from "../../src/v3/types.ts";

function item(overrides: Partial<AstraInput> = {}): AstraInput {
  const c = candidate();
  return {
    candidate: c,
    proof: proof(c),
    repair: { candidateId: c.id, severity: c.severity, exit: "VERIFIED", attempts: [], finalPatch: "@@ -1 +1 @@\n-a\n+b", durationMs: 1, toolCalls: 1, reason: "ok" },
    verification: { passed: true, durationMs: 1, steps: [] },
    ...overrides,
  };
}

function router(client: ReturnType<typeof scriptedClient>): ModelRouter {
  return new ModelRouter({ clients: { astra: client }, config: resolveV3Config().models, maxCalls: 6 });
}

const validReport = {
  verdict: { decision: "approve", confidence: 0.9, rationale: "everything verified" },
  summary: "Fixes are verified.",
  walkthrough: [{ file: "src/a.ts", intent: "fix", changeSummary: "removed undefined", risk: "low" }],
  risks: [],
  testCoverage: { assessed: true, signals: ["browser"], gaps: [] },
  observations: [],
  limitations: [],
};

test("finalReview produces per-finding reviews and a PR-level report", async () => {
  const client = scriptedClient("astra", (task) => {
    if (task.label === "astra-report") return JSON.stringify(validReport);
    return JSON.stringify({
      reviews: [{ candidateId: "c_test01", validity: "valid", fixCorrectness: "correct", risk: "low", approval: "approve", confidence: 0.9, summary: "fixed", rationale: "repro passes", evidenceRefs: ["src/a.ts:1"] }],
    });
  });
  const outcome = await finalReview(
    { items: [item()], context: contextWith([{ path: "src/a.ts", content: "const a = 1;\n" }]), instructions: "be strict", learnings: ["prefer async"] },
    router(client),
    silentLogger,
  );
  assert.equal(outcome.reviews.length, 1);
  assert.equal(outcome.reviews[0].rationale, "repro passes");
  assert.equal(outcome.report.source, "model");
  assert.equal(outcome.report.verdict.decision, "approve");
  const reportCall = client.calls.find((call) => call.label === "astra-report");
  assert.ok(reportCall);
  assert.match(reportCall!.user, /be strict/);
  assert.match(reportCall!.user, /prefer async/);
});

test("a report failure keeps model-authored per-finding reviews", async () => {
  const client = scriptedClient("astra", (task) => {
    if (task.label === "astra-report") return "not json";
    return JSON.stringify({
      reviews: [{ candidateId: "c_test01", validity: "valid", fixCorrectness: "correct", risk: "low", approval: "approve", confidence: 0.9, summary: "fixed" }],
    });
  });
  const outcome = await finalReview({ items: [item()], context: contextWith([]) }, router(client), silentLogger);
  assert.equal(outcome.reviews[0].summary, "fixed");
  assert.equal(outcome.report.source, "fallback");
});

test("a model outage degrades the whole review deterministically", async () => {
  const failing = {
    id: "failing",
    async complete() {
      throw new ModelError("gateway down", true);
    },
  };
  const models = new ModelRouter({ clients: { astra: failing }, config: resolveV3Config({ models: { maxRetries: 0 } }).models, maxCalls: 6 });
  const outcome = await finalReview({ items: [item()], context: contextWith([]) }, models, silentLogger);
  assert.equal(outcome.reviews.length, 1);
  assert.equal(outcome.report.source, "fallback");
  assert.match(outcome.report.limitations.join(" "), /fallback/i);
});

test("guardrails raise an approving report over unverified critical findings", () => {
  const c = candidate({ severity: "critical" });
  const unverified: AstraInput = { candidate: c, proof: proof(c) };
  const report: FinalReviewReport = {
    ...fallbackReport({ items: [unverified], context: contextWith([]) }),
    verdict: { decision: "approve", confidence: 0.95, rationale: "looks good" },
    source: "model",
  };
  const guarded = applyVerdictGuardrails(report, [unverified]);
  assert.equal(guarded.verdict.decision, "request_changes");
  assert.match(guarded.verdict.rationale, /guardrail/);
  assert.match(guarded.limitations.join(" "), /guardrail/);
});

test("guardrails leave a stricter model verdict untouched", () => {
  const verified = item({
    repair: { candidateId: "c_test01", severity: "high", exit: "VERIFIED", attempts: [], finalPatch: "@@ -1 +1 @@\n-a\n+b", durationMs: 1, toolCalls: 1, reason: "ok" },
    verification: { passed: true, durationMs: 1, steps: [] },
  });
  const report = fallbackReport({ items: [verified], context: contextWith([]) });
  const guarded = applyVerdictGuardrails({ ...report, verdict: { decision: "request_changes", confidence: 0.9, rationale: "concern" } }, [verified]);
  assert.equal(guarded.verdict.decision, "request_changes");
});
