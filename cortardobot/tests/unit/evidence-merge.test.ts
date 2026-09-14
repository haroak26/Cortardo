import assert from "node:assert/strict";
import test from "node:test";
import { mergeEvidence } from "../../src/stages/evidence-merge";
import { DEFAULT_CONFIG } from "../../src/config";
import { makeContext, makeHypothesis } from "../helpers/factories";
import type { Hypothesis } from "../../src/types";

function merge(hypotheses: Hypothesis[], context = makeContext()) {
  return mergeEvidence(hypotheses, context, DEFAULT_CONFIG);
}

test("mergeEvidence merges identical claims across agents", () => {
  const { candidates } = merge([
    makeHypothesis({ id: "h1", agent: "luna-bug", evidence: ["src/app.ts:10"] }),
    makeHypothesis({ id: "h2", agent: "luna-security", evidence: ["src/app.ts:12"] }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].occurrences, 2);
  assert.equal(candidates[0].mergedFrom.length, 2);
  assert.deepEqual(candidates[0].evidence, ["src/app.ts:10", "src/app.ts:12"]);
});

test("mergeEvidence keeps claims from different files separate", () => {
  const { candidates } = merge([
    makeHypothesis({ id: "h1", file: "src/a.ts", evidence: ["src/a.ts:1"] }),
    makeHypothesis({ id: "h2", file: "src/b.ts", evidence: ["src/b.ts:1"] }),
  ]);
  assert.equal(candidates.length, 2);
});

test("mergeEvidence keeps the highest severity and confidence", () => {
  const { candidates } = merge([
    makeHypothesis({ id: "h1", severity: "medium", confidence: 0.6 }),
    makeHypothesis({ id: "h2", severity: "critical", confidence: 0.9 }),
  ]);
  assert.equal(candidates[0].severity, "critical");
  assert.equal(candidates[0].confidence, 0.9);
});

test("mergeEvidence drops generic and short claims", () => {
  const { candidates, stats } = merge([
    makeHypothesis({ id: "h1", claim: "Consider adding tests for this module" }),
    makeHypothesis({ id: "h2", claim: "Fix it" }),
    makeHypothesis({ id: "h3", claim: "Real defect in the session check" }),
  ]);
  assert.equal(candidates.length, 1);
  assert.equal(stats.dropped, 2);
});

test("mergeEvidence drops low confidence and low value info claims", () => {
  const { candidates } = merge([
    makeHypothesis({ id: "h1", claim: "A possible issue with the parser", confidence: 0.2 }),
    makeHypothesis({ id: "h2", claim: "An informational note about naming", severity: "info", confidence: 0.4 }),
  ]);
  assert.equal(candidates.length, 0);
});

test("mergeEvidence scores higher severity above lower severity", () => {
  const { candidates } = merge([
    makeHypothesis({ id: "h1", claim: "Minor style drift in naming", severity: "low", file: "src/a.ts", evidence: ["src/a.ts:1"] }),
    makeHypothesis({ id: "h2", claim: "Critical injection through query string", severity: "critical", file: "src/b.ts", evidence: ["src/b.ts:1"] }),
  ]);
  assert.equal(candidates[0].severity, "critical");
  assert.ok(candidates[0].score > candidates[1].score);
});

test("mergeEvidence caps the number of candidates", () => {
  const hypotheses = Array.from({ length: 25 }, (_, index) =>
    makeHypothesis({
      id: `h${index}`,
      claim: `Distinct defect number ${index} in module ${index}`,
      file: `src/module${index}.ts`,
      evidence: [`src/module${index}.ts:1`],
    }),
  );
  const { candidates } = merge(hypotheses);
  assert.equal(candidates.length, DEFAULT_CONFIG.judge.maxCandidates);
});

test("mergeEvidence rewards corroboration and changed-line proximity", () => {
  const close = makeHypothesis({ id: "h1", evidence: ["src/app.ts:11"] });
  const far = makeHypothesis({
    id: "h2",
    claim: "Same class of defect far from the diff",
    file: "src/other.ts",
    evidence: ["src/other.ts:900"],
  });
  const context = makeContext({
    files: [
      {
        path: "src/app.ts",
        status: "modified",
        language: "TypeScript",
        additions: 1,
        deletions: 0,
        addedLines: [{ line: 10, text: "changed" }],
        removedLines: [],
      },
    ],
    riskSignals: [{ id: "secret-literal", detail: "", weight: 3 }],
  });
  const { candidates } = merge([close, makeHypothesis({ id: "h3", evidence: ["src/app.ts:10"] }), far], context);
  const appCandidate = candidates.find((candidate) => candidate.file === "src/app.ts");
  const otherCandidate = candidates.find((candidate) => candidate.file === "src/other.ts");
  assert.ok(appCandidate && otherCandidate);
  assert.ok(appCandidate.score > otherCandidate.score);
});

test("mergeEvidence returns stats about dropped candidates", () => {
  const { stats } = merge([
    makeHypothesis({ id: "h1" }),
    makeHypothesis({ id: "h2", claim: "Consider refactoring" }),
  ]);
  assert.equal(stats.input, 2);
  assert.equal(stats.output, 1);
  assert.ok(stats.dropped >= 1);
});
