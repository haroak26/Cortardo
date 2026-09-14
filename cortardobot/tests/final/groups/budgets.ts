import assert from "node:assert/strict";
import { CortadoEngine } from "../../../src/engine";
import { FIXTURES, fixtureFiles } from "../../../fixtures/prs";
import { ScenarioSandbox } from "../../dry/scenario";
import { selectAgents } from "../../../src/agents/roster";
import { deterministicJudge } from "../../../src/judge-policy";
import { mergeEvidence } from "../../../src/stages/evidence-merge";
import { verifyRepairs } from "../../../src/stages/verify";
import { DEFAULT_REPO_COMMANDS } from "../../../src/stages/proof";
import { resolveConfig } from "../../../src/config";
import { MemorySandbox } from "../../../src/sandbox";
import { SimulatedClock } from "../../../src/util/clock";
import { silentLogger } from "../../../src/util/logger";
import { makeCandidate, makeContext, makeHypothesis, makeProof, makeRepair } from "../../helpers/factories";
import { defineCases } from "../../exhaustive/types";
import type { RepairBehavior } from "../../../src/models/dry";
import type { CortadoResult } from "../../../src/types";

async function runEngine(config: Record<string, unknown>, input = FIXTURES[0].pullRequest, repair: RepairBehavior = "always-fail") {
  const clock = new SimulatedClock(0, (config.__autoAdvanceMs as number) ?? 0);
  delete (config as { __autoAdvanceMs?: number }).__autoAdvanceMs;
  const fixture = FIXTURES[0];
  const sandbox = new ScenarioSandbox({ fixture, proof: "confirm", repair }, fixtureFiles(fixture), clock);
  const engine = new CortadoEngine({
    mode: "dry",
    sandbox,
    clock,
    logger: silentLogger,
    dryOptions: { repairBehavior: repair },
    ...(config as object),
  });
  const result: CortadoResult = await engine.run(input);
  return { result, sandbox };
}

export function buildBudgetGroup() {
  return defineCases("budgets", [
    {
      name: "judge proof budget caps PROVE decisions",
      run: () => {
        const candidates = Array.from({ length: 6 }, (_, index) =>
          makeCandidate({ id: `c${index}`, score: 10 - index, confidence: 0.9 }),
        );
        const decisions = deterministicJudge(
          candidates,
          makeContext(),
          resolveConfig({ mode: "dry", judge: { maxToProve: 1 } }),
        );
        assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, 1);
      },
    },
    {
      name: "judge budget of zero proves nothing",
      run: () => {
        const decisions = deterministicJudge(
          [makeCandidate({ id: "c1" })],
          makeContext(),
          resolveConfig({ mode: "dry", judge: { maxToProve: 0 } }),
        );
        assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, 0);
      },
    },
    {
      name: "judge confidence floor blocks weak candidates",
      run: () => {
        const decisions = deterministicJudge(
          [makeCandidate({ id: "c1", confidence: 0.6 })],
          makeContext(),
          resolveConfig({ mode: "dry", judge: { minConfidence: 0.99 } }),
        );
        assert.notEqual(decisions[0].verdict, "PROVE");
      },
    },
    {
      name: "judge severity floor blocks lower severities",
      run: () => {
        const decisions = deterministicJudge(
          [makeCandidate({ id: "c1", severity: "high" })],
          makeContext(),
          resolveConfig({ mode: "dry", judge: { minSeverity: "critical" } }),
        );
        assert.notEqual(decisions[0].verdict, "PROVE");
      },
    },
    {
      name: "candidate cap limits merged evidence",
      run: () => {
        const hypotheses = Array.from({ length: 8 }, (_, index) =>
          makeHypothesis({
            id: `h${index}`,
            claim: `Distinct defect number ${index} in module ${index}`,
            file: `src/module-${index}.ts`,
            evidence: [`src/module-${index}.ts:1`],
          }),
        );
        const { candidates } = mergeEvidence(
          hypotheses,
          makeContext(),
          resolveConfig({ mode: "dry", judge: { maxCandidates: 2 } }),
        );
        assert.equal(candidates.length, 2);
      },
    },
    {
      name: "proof hypothesis cap limits executions",
      run: async () => {
        const { result } = await runEngine({ proof: { maxHypotheses: 1 } });
        assert.ok(result.proofs.length <= 1);
      },
    },
    {
      name: "proof budget of zero produces errors",
      run: async () => {
        const { result } = await runEngine({ proof: { totalMs: 0 }, __autoAdvanceMs: 1 });
        assert.equal(result.proofs[0]?.status, "error");
      },
    },
    {
      name: "proof per-hypothesis budget of zero produces errors",
      run: async () => {
        const { result } = await runEngine({ proof: { perHypothesisMs: 0 }, __autoAdvanceMs: 1 });
        assert.equal(result.proofs[0]?.status, "error");
      },
    },
    {
      name: "proof strategy cap limits attempts",
      run: async () => {
        const { result } = await runEngine({ proof: { maxStrategies: 1 } });
        assert.ok(result.proofs.every((proof) => proof.attempts.length <= 1));
      },
    },
    {
      name: "proof with a generous budget still confirms",
      run: async () => {
        const { result } = await runEngine({ proof: { totalMs: 60_000, maxHypotheses: 5 } });
        assert.equal(result.proofs[0]?.status, "confirmed");
      },
    },
    {
      name: "repair attempt budget of one exits unresolved",
      run: async () => {
        const { result } = await runEngine({ repair: { maxAttempts: 1 } }, FIXTURES[0].pullRequest, "always-fail");
        assert.equal(result.repairs[0]?.exit, "UNRESOLVED");
        assert.equal(result.repairs[0]?.attempts.length, 1);
      },
    },
    {
      name: "repair attempt budget of two exits unresolved",
      run: async () => {
        const { result } = await runEngine({ repair: { maxAttempts: 2 } }, FIXTURES[0].pullRequest, "always-fail");
        assert.equal(result.repairs[0]?.exit, "UNRESOLVED");
        assert.equal(result.repairs[0]?.attempts.length, 2);
      },
    },
    {
      name: "repair tool call budget of one exits budget exhausted",
      run: async () => {
        const { result } = await runEngine({ repair: { maxToolCalls: 1 } });
        assert.equal(result.repairs[0]?.exit, "BUDGET_EXHAUSTED");
      },
    },
    {
      name: "repair tool call budget of two exits budget exhausted",
      run: async () => {
        const { result } = await runEngine({ repair: { maxToolCalls: 2 } });
        assert.equal(result.repairs[0]?.exit, "BUDGET_EXHAUSTED");
      },
    },
    {
      name: "repair time budget of zero exits budget exhausted",
      run: async () => {
        const { result } = await runEngine({ repair: { maxTimeMs: 0 }, __autoAdvanceMs: 5 });
        assert.equal(result.repairs[0]?.exit, "BUDGET_EXHAUSTED");
      },
    },
    {
      name: "repair succeeds within a generous budget",
      run: async () => {
        const { result } = await runEngine({ repair: { maxAttempts: 3, maxToolCalls: 12, maxTimeMs: 45_000 } }, FIXTURES[0].pullRequest, "fix");
        assert.equal(result.repairs[0]?.exit, "VERIFIED");
      },
    },
    {
      name: "model call cap limits total model calls without failing the run",
      run: async () => {
        const { result } = await runEngine({ maxModelCalls: 1 });
        assert.equal(result.status, "completed");
        assert.equal(result.usage.calls, 1);
      },
    },
    {
      name: "model call cap of zero still completes",
      run: async () => {
        const { result } = await runEngine({ maxModelCalls: 0 });
        assert.equal(result.status, "completed");
      },
    },
    {
      name: "global timeout fails the run",
      run: async () => {
        const slowModel = {
          id: "slow",
          dryRun: true,
          complete: async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            return { text: "{}", model: "slow", tokensIn: 1, tokensOut: 1, durationMs: 30 };
          },
        };
        const engine = new CortadoEngine({
          mode: "dry",
          models: { luna: slowModel, terra: slowModel, astra: slowModel },
          globalTimeoutMs: 1,
          logger: silentLogger,
        });
        const result = await engine.run({ title: "timeout", files: [] });
        assert.equal(result.status, "failed");
        assert.match(result.error ?? "", /timed out/);
      },
    },
    {
      name: "global timeout with a generous value completes",
      run: async () => {
        const { result } = await runEngine({ globalTimeoutMs: 60_000 });
        assert.equal(result.status, "completed");
      },
    },
    {
      name: "swarm concurrency of one still produces hypotheses",
      run: async () => {
        const { result } = await runEngine({ swarm: { concurrency: 1 } });
        assert.ok(result.candidates.length >= 1);
      },
    },
    {
      name: "swarm size cap of one trims the roster",
      run: () => {
        const agents = selectAgents(
          makeContext({ size: "complex", classification: ["AUTH", "API", "DATABASE"], tests: ["src/a.test.ts"] }),
          resolveConfig({ mode: "dry", swarm: { complex: 1 } }),
        );
        assert.equal(agents.length, 1);
      },
    },
    {
      name: "combined tight budgets produce a static-only report",
      run: async () => {
        const { result } = await runEngine({
          judge: { maxToProve: 0 },
          proof: { maxHypotheses: 0 },
          repair: { maxAttempts: 1 },
        });
        assert.equal(result.summary.issuesConfirmed, 0);
        assert.equal(result.repairs.length, 0);
      },
    },
    {
      name: "verification budget skipping is reported",
      run: async () => {
        const clock = new SimulatedClock(0, 1);
        const sandbox = new MemorySandbox({
          files: { "src/app.ts": "content", "src/app.test.ts": "test" },
          handler: (command) => ({ command, exitCode: 0, stdout: "ok", stderr: "", durationMs: 0, timedOut: false }),
        });
        const reports = await verifyRepairs(
          [makeRepair({ candidateId: "c1", exit: "VERIFIED" })],
          [makeCandidate({ id: "c1", file: "src/app.ts" })],
          [makeProof({ candidateId: "c1" })],
          makeContext({ tests: ["src/app.test.ts"] }),
          {
            sandbox,
            config: resolveConfig({ mode: "dry", verify: { totalMs: 0 } }),
            commands: DEFAULT_REPO_COMMANDS,
            logger: silentLogger,
            now: () => clock.now(),
          },
        );
        const report = reports.get("c1");
        assert.ok(report);
        assert.ok(report.steps.some((step) => step.skipped));
      },
    },
    {
      name: "wrong-layer repair with a single attempt exits unresolved",
      run: async () => {
        const { result } = await runEngine({ repair: { maxAttempts: 1 } }, FIXTURES[0].pullRequest, "wrong-layer");
        assert.equal(result.repairs[0]?.exit, "UNRESOLVED");
        assert.equal(result.repairs[0]?.attempts.length, 1);
      },
    },
  ]);
}
