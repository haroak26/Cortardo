import assert from "node:assert/strict";
import test, { after } from "node:test";
import { FIXTURES } from "../../fixtures/prs";
import { runScenario } from "../dry/run-case";
import { detectForFiles } from "../../src/agents/detectors";
import { parseChangedFiles } from "../../src/stages/change-intelligence";
import { selectAgents } from "../../src/agents/roster";
import { resolveConfig } from "../../src/config";

const originalFetch = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new Error("network disabled in integration tests");
}) as typeof fetch;
after(() => {
  globalThis.fetch = originalFetch;
});

const config = resolveConfig({ mode: "dry" });

test("integration: auth fixture completes with a verified fix", async () => {
  const { result } = await runScenario({ fixture: FIXTURES[0], proof: "confirm", repair: "fix" });
  assert.equal(result.status, "completed");
  assert.equal(result.summary.issuesConfirmed, 1);
  assert.equal(result.summary.issuesFixed, 1);
  assert.equal(result.summary.issuesVerified, 1);
  assert.match(result.markdown, /\[FIXED\] HIGH/);
  assert.match(result.markdown, /Reproduction:/);
  assert.equal(result.reviews[0]?.approval, "approve");
  assert.ok(result.usage.credits > 0);
});

test("integration: pipeline is deterministic across runs", async () => {
  const first = await runScenario({ fixture: FIXTURES[0], proof: "confirm", repair: "fix" });
  const second = await runScenario({ fixture: FIXTURES[0], proof: "confirm", repair: "fix" });
  assert.deepEqual(
    first.result.candidates.map((candidate) => candidate.id),
    second.result.candidates.map((candidate) => candidate.id),
  );
  assert.deepEqual(first.result.summary, second.result.summary);
  assert.equal(first.result.markdown, second.result.markdown);
});

test("integration: successful runs execute repair and verification stages", async () => {
  const { result } = await runScenario({ fixture: FIXTURES[0], proof: "confirm", repair: "fix" });
  const stages = result.events.map((event) => event.stage);
  assert.ok(stages.includes("repair"));
  assert.ok(stages.includes("verify"));
  assert.ok(stages.includes("cleanup"));
  assert.notEqual(result.timings.repair, undefined);
  assert.notEqual(result.timings.verify, undefined);
  assert.ok(result.findings.every((finding) => finding.verification?.passed));
});

test("integration: disproven runs skip repair and verification", async () => {
  const { result } = await runScenario({ fixture: FIXTURES[0], proof: "no-repro", repair: "fix" });
  assert.equal(result.repairs.length, 0);
  assert.equal(result.timings.repair, undefined);
  assert.equal(result.timings.verify, undefined);
  assert.match(result.markdown, /No confirmed issues/);
});

test("integration: complex fixture triggers a larger but capped swarm", async () => {
  const { result } = await runScenario({ fixture: FIXTURES[9], proof: "confirm", repair: "fix" });
  const agents = selectAgents(result.context!, config);
  assert.ok(agents.length <= config.swarm.complex);
  assert.ok(agents.length > config.swarm.tiny);
  assert.ok(result.summary.issuesFixed >= 4);
  assert.match(result.markdown, /\[FIXED\]/);
});

test("integration: unsafe repairs never change the sandbox", async () => {
  const { result, sandbox } = await runScenario({ fixture: FIXTURES[0], proof: "confirm", repair: "unsafe" });
  assert.equal(result.repairs[0]?.exit, "UNSAFE");
  assert.equal(sandbox.patchedFiles.size, 0);
});

test("integration: always-fail repairs stay unresolved with diagnosis data", async () => {
  const { result } = await runScenario({ fixture: FIXTURES[0], proof: "confirm", repair: "always-fail" });
  const repair = result.repairs[0];
  assert.equal(repair.exit, "UNRESOLVED");
  assert.equal(repair.attempts.length, 3);
  assert.ok(repair.attempts.every((attempt) => attempt.diagnosis));
  assert.equal(result.findings[0]?.review?.approval, "request_changes");
});

test("integration: detectors cover every planted rule in the complex fixture", async () => {
  const fixture = FIXTURES[9];
  const detected = new Set(
    detectForFiles(
      parseChangedFiles(fixture.pullRequest.files),
      ["bug", "auth", "security", "regression", "runtime", "performance", "database", "api", "ui", "config"],
      200,
    ).map((finding) => finding.ruleId),
  );
  for (const rule of fixture.expected.ruleIds) {
    assert.ok(detected.has(rule), `missing detector ${rule}`);
  }
});

test("integration: result markdown is stable and complete", async () => {
  const { result } = await runScenario({ fixture: FIXTURES[9], proof: "confirm", repair: "fix" });
  assert.match(result.markdown, /Classification:/);
  assert.match(result.markdown, /Astra:/);
  assert.match(result.markdown, /Verification:/);
  assert.ok(result.markdown.endsWith("\n"));
});
