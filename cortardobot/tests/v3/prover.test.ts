import assert from "node:assert/strict";
import { test } from "node:test";
import { ModelRouter } from "../../src/v3/models.ts";
import { resolveV3Config } from "../../src/v3/config.ts";
import { MemorySandbox } from "../../src/v3/sandbox-memory.ts";
import { buildLoopCoverage, proveCandidatesWithProver } from "../../src/v3/prover.ts";
import { candidate, contextWith, proof as confirmedProof, scriptedClient, silentLogger } from "./helpers.ts";
import type { JudgeDecision, ModelTask, PRContext } from "../../src/v3/types.ts";
import type { RepoProfile } from "../../src/v3/sandbox.ts";

const USAGE = "export function daysFor(period: string) {\n  return period === '7d' ? 30 : 7;\n}\n";

function repoProfile(overrides: Partial<RepoProfile> = {}): RepoProfile {
  return {
    packageManager: "npm",
    installCommand: "npm ci",
    hasNodeModules: true,
    hasTests: true,
    testCommand: "npx vitest run",
    testSingle: (file: string) => `npx vitest run ${file}`,
    scripts: {},
    ...overrides,
  };
}

function usageContext(): PRContext {
  return contextWith([{ path: "src/usage.ts", content: USAGE }], { repoTests: [] });
}

function usageCandidate(overrides: Record<string, unknown> = {}) {
  return candidate({
    id: "c_usage",
    file: "src/usage.ts",
    line: 2,
    evidence: ["src/usage.ts:2"],
    severity: "high",
    source: "luna",
    claim: "the period selector returns the opposite number of days",
    suggestedProof: "none",
    check: undefined,
    suggestedExperiment: "assert that the 7d period requests 7 days",
    confidence: 0.8,
    ...overrides,
  });
}

function routerFor(luna: ReturnType<typeof scriptedClient>, codegen?: ReturnType<typeof scriptedClient>): ModelRouter {
  return new ModelRouter({
    clients: { luna, codegen: codegen ?? luna },
    config: resolveV3Config().models,
    maxCalls: 40,
  });
}

function writeAndRunProbe(name: string, content: string): string {
  return JSON.stringify({
    thought: "author a probe",
    actions: [
      { tool: "write_probe", args: { name, content } },
      { tool: "run_probe", args: { name } },
    ],
  });
}

function proverDeps(sandbox: MemorySandbox, models: ModelRouter, context: PRContext, overrides: Record<string, unknown> = {}) {
  return {
    sandbox,
    profile: repoProfile(),
    context,
    models,
    logger: silentLogger,
    maxCandidates: 2,
    maxTurns: 1,
    maxToolsPerTurn: 3,
    escalations: 0,
    deadline: Date.now() + 60_000,
    ...overrides,
  };
}

test("prover authors a probe, confirms it twice and attaches the artifact", async () => {
  const context = usageContext();
  const sandbox = new MemorySandbox({
    files: { "src/usage.ts": USAGE },
    profile: { testSingle: (file: string) => `npx vitest run ${file}`, testCommand: "npx vitest run" },
    execHandler: (command) => {
      if (command.includes("repro.test.ts")) {
        return { exitCode: 1, stdout: "FAIL src/usage.ts > 7d returns 7\nAssertionError: expected 30 to be 7" };
      }
      return { exitCode: 0, stdout: "ok" };
    },
  });
  const luna = scriptedClient("luna", (task: ModelTask) => {
    if (task.kind === "prover") {
      return writeAndRunProbe("repro.test.ts", "import { daysFor } from '../../src/usage'\ntest('7d returns 7', () => { expect(daysFor('7d')).toBe(7) })");
    }
    return "{}";
  });
  const value = usageCandidate();
  const outcome = await proveCandidatesWithProver([value], proverDeps(sandbox, routerFor(luna), context));

  assert.equal(outcome.coverage.length, 0);
  assert.equal(outcome.proofs.length, 1);
  const result = outcome.proofs[0];
  assert.equal(result.status, "confirmed");
  assert.equal(result.strategy, "probe");
  assert.equal(result.artifact?.kind, "probe");
  assert.equal(result.artifact?.preFixFailures, 2, "a probe must fail twice before it confirms");
  assert.equal(result.artifact?.content?.includes("daysFor"), true);
  assert.equal(value.artifact?.artifactHash, result.artifact?.artifactHash, "the artifact travels with the candidate for repair/verify");
});

test("prover records UNPROVABLE when the probe cannot run", async () => {
  const context = usageContext();
  const sandbox = new MemorySandbox({
    files: { "src/usage.ts": USAGE },
    profile: { testSingle: (file: string) => `npx vitest run ${file}`, testCommand: "npx vitest run" },
    execHandler: () => ({ exitCode: 1, stdout: "Error: Cannot find module '../../src/usage'" }),
  });
  const luna = scriptedClient("luna", (task: ModelTask) =>
    task.kind === "prover" ? writeAndRunProbe("broken.test.ts", "import x from 'nowhere'\ntest('x', () => expect(x).toBe(1))") : "{}",
  );
  const value = usageCandidate({ id: "c_broken" });
  const outcome = await proveCandidatesWithProver([value], proverDeps(sandbox, routerFor(luna), context));

  assert.equal(outcome.proofs.length, 0);
  assert.equal(outcome.coverage.length, 1);
  assert.equal(outcome.coverage[0].proofState, "UNPROVABLE");
  assert.equal(value.artifact, undefined);
});

test("prover fallback runs the probe through vitest without a masking pipe", async () => {
  const context = usageContext();
  const commands: string[] = [];
  const sandbox = new MemorySandbox({
    files: { "src/usage.ts": USAGE },
    execHandler: (command) => {
      commands.push(command);
      if (command.includes("repro.test.ts")) {
        return { exitCode: 1, stdout: "FAIL src/usage.ts > 7d returns 7\nAssertionError: expected 30 to be 7" };
      }
      return { exitCode: 0, stdout: "ok" };
    },
  });
  const luna = scriptedClient("luna", (task: ModelTask) =>
    task.kind === "prover"
      ? writeAndRunProbe("repro.test.ts", "import { daysFor } from '../../src/usage'\ntest('7d returns 7', () => { expect(daysFor('7d')).toBe(7) })")
      : "{}",
  );
  const value = usageCandidate({ id: "c_fallback", suggestedProof: "none", check: undefined });
  const outcome = await proveCandidatesWithProver([value], proverDeps(sandbox, routerFor(luna), context));

  assert.equal(outcome.proofs.length, 1, "a failing fallback probe must confirm");
  assert.equal(outcome.proofs[0].artifact?.command?.includes("--reporter=basic"), false, "vitest no longer supports the basic reporter");
  assert.equal(outcome.proofs[0].artifact?.command?.includes("| tail"), false, "a pipe would mask the probe exit code");
  assert.ok(commands.every((command) => !command.includes("| tail")), "no probe command may pipe away its exit code");
});

test("prover retries a lazy luna turn before recording UNPROVABLE", async () => {
  const context = usageContext();
  const sandbox = new MemorySandbox({
    files: { "src/usage.ts": USAGE },
    profile: { testSingle: (file: string) => `npx vitest run ${file}`, testCommand: "npx vitest run" },
    execHandler: (command) => {
      if (command.includes("repro.test.ts")) {
        return { exitCode: 1, stdout: "FAIL src/usage.ts > 7d returns 7\nAssertionError: expected 30 to be 7" };
      }
      return { exitCode: 0, stdout: "ok" };
    },
  });
  const luna = scriptedClient("luna", (task: ModelTask, index: number) =>
    task.kind === "prover" && index === 0
      ? JSON.stringify({ thought: "no tools available", actions: [], done: true, summary: "No executable reproduction possible without repository inspection and probe execution tools." })
      : task.kind === "prover"
        ? writeAndRunProbe("repro.test.ts", "import { daysFor } from '../../src/usage'\ntest('7d returns 7', () => { expect(daysFor('7d')).toBe(7) })")
        : "{}",
  );
  const value = usageCandidate({ id: "c_retry", suggestedProof: "none", check: undefined });
  const outcome = await proveCandidatesWithProver([value], proverDeps(sandbox, routerFor(luna), context, { attempts: 2, maxTurns: 1 }));

  assert.equal(outcome.proofs.length, 1, "the retry must still get a chance to author a probe");
  assert.equal(outcome.coverage.length, 0);
  assert.equal(luna.calls.filter((task) => task.kind === "prover").length, 2, "luna was retried once");
});

test("prover treats a probe-runner startup error as a harness error, not a reproduction", async () => {
  const context = usageContext();
  const sandbox = new MemorySandbox({
    files: { "src/usage.ts": USAGE },
    execHandler: () => ({
      exitCode: 1,
      stdout: "Startup Error: Failed to load custom Reporter from basic (src/usage.ts repro)",
    }),
  });
  const luna = scriptedClient("luna", (task: ModelTask) =>
    task.kind === "prover" ? writeAndRunProbe("startup.test.ts", "test('x', () => { expect(1).toBe(2) })") : "{}",
  );
  const value = usageCandidate({ id: "c_startup", suggestedProof: "none", check: undefined });
  const outcome = await proveCandidatesWithProver([value], proverDeps(sandbox, routerFor(luna), context));

  assert.equal(outcome.proofs.length, 0, "a startup error must never confirm a reproduction");
  assert.equal(outcome.coverage[0]?.proofState, "UNPROVABLE");
  assert.equal(value.artifact, undefined);
});

test("prover rejects a failure that does not reference the candidate and escalates to codegen", async () => {
  const context = usageContext();
  const sandbox = new MemorySandbox({
    files: { "src/usage.ts": USAGE },
    profile: { testSingle: (file: string) => `npx vitest run ${file}`, testCommand: "npx vitest run" },
    execHandler: (command) => {
      if (command.includes("unrelated.test.ts")) return { exitCode: 1, stdout: "AssertionError: expected 1 to be 2" };
      if (command.includes("targeted.test.ts")) {
        return { exitCode: 1, stdout: "FAIL src/usage.ts > period mismatch: expected 30 to be 7" };
      }
      return { exitCode: 0, stdout: "ok" };
    },
  });
  const luna = scriptedClient("luna", (task: ModelTask) =>
    task.kind === "prover" ? writeAndRunProbe("unrelated.test.ts", "test('unrelated failure', () => { expect(1).toBe(2) })") : "{}",
  );
  const codegen = scriptedClient("codegen", (task: ModelTask) =>
    task.kind === "prover" ? writeAndRunProbe("targeted.test.ts", "import { daysFor } from '../../src/usage'\ntest('period', () => expect(daysFor('7d')).toBe(7))") : "{}",
  );
  const value = usageCandidate({ id: "c_escalated" });
  const outcome = await proveCandidatesWithProver(
    [value],
    proverDeps(sandbox, routerFor(luna, codegen), context, { escalations: 1, maxTurns: 2 }),
  );

  assert.equal(outcome.proofs.length, 1);
  assert.equal(outcome.proofs[0].artifact?.path, "targeted.test.ts");
  assert.ok(codegen.calls.some((task) => task.label.includes("-codegen-")), "the near-miss escalated to codegen");
  assert.ok(luna.calls.some((task) => task.kind === "prover"), "luna was tried first");
});

test("prover leaves browser-check candidates to the proof stage", async () => {
  const context = usageContext();
  const sandbox = new MemorySandbox({ files: { "src/usage.ts": USAGE } });
  const luna = scriptedClient("luna", () => "{}");
  const value = usageCandidate({
    id: "c_browser",
    check: { path: "/usage", assert: { type: "noPageError" }, expected: "pass", label: "usage page renders" },
  });
  const outcome = await proveCandidatesWithProver([value], proverDeps(sandbox, routerFor(luna), context));
  assert.equal(outcome.proofs.length, 0);
  assert.equal(outcome.coverage.length, 0);
  assert.equal(luna.calls.length, 0);
});

test("buildLoopCoverage gives every judge-approved candidate a terminal state", () => {
  const proved = usageCandidate({ id: "c_proved" });
  const unprovable = usageCandidate({ id: "c_unprovable" });
  const errored = usageCandidate({ id: "c_errored" });
  const decisions: JudgeDecision[] = [
    { candidateId: proved.id, verdict: "PROVE", reason: "material", priority: 1 },
    { candidateId: unprovable.id, verdict: "PROVE", reason: "material", priority: 2 },
    { candidateId: errored.id, verdict: "PROVE", reason: "material", priority: 3 },
    { candidateId: "c_static", verdict: "STATIC_ONLY", reason: "low value", priority: 90 },
  ];
  const confirmed = confirmedProof(proved);
  const failed: typeof confirmed = { ...confirmedProof(errored), candidateId: errored.id, status: "error", explanation: "browser harness failed" };
  const coverage = buildLoopCoverage(
    decisions,
    [proved, unprovable, errored],
    [confirmed, failed],
    [{ candidateId: unprovable.id, severity: unprovable.severity, proofState: "UNPROVABLE", reason: "no reproduction" }],
  );
  assert.equal(coverage.judgeProve, 3);
  assert.equal(coverage.proven, 1);
  assert.equal(coverage.proofUnavailable, 1);
  assert.equal(coverage.proofErrors, 1);
  assert.equal(coverage.candidates.length, 3);
  assert.equal(coverage.candidates.find((entry) => entry.candidateId === proved.id)?.proofState, "PROVEN");
  assert.equal(coverage.candidates.find((entry) => entry.candidateId === unprovable.id)?.proofState, "UNPROVABLE");
  assert.equal(coverage.candidates.find((entry) => entry.candidateId === errored.id)?.proofState, "ERROR");
});
