import assert from "node:assert/strict";
import { mergeEvidence } from "../../../src/stages/evidence-merge";
import { deterministicJudge, enforceJudgePolicy } from "../../../src/stages/judge";
import { buildProofSteps, evaluateStep, proveCandidates, DEFAULT_REPO_COMMANDS } from "../../../src/stages/proof";
import { assessPatchSafety } from "../../../src/sandbox/safety";
import { MemorySandbox } from "../../../src/sandbox";
import { commandResult } from "../../../src/sandbox/types";
import { resolveConfig } from "../../../src/config";
import { silentLogger } from "../../../src/util/logger";
import { makeCandidate, makeContext, makeHypothesis } from "../../helpers/factories";
import { defineCases } from "../../exhaustive/types";
import type { JudgeDecision, ProofStep } from "../../../src/types";

const config = resolveConfig({ mode: "dry" });

function step(overrides: Partial<ProofStep> = {}): ProofStep {
  return {
    strategy: overrides.strategy ?? "existing_test",
    command: overrides.command ?? "npm test -- a.test.ts",
    expectation: overrides.expectation ?? "fail",
    marker: overrides.marker,
    description: overrides.description ?? "desc",
  };
}

function safety(patch: string, path: string, removed: string[] = [], added: string[] = []) {
  return assessPatchSafety(patch, [{ path, removedLines: removed, addedLines: added }]);
}

export function buildPipelineDeepGroup() {
  const cases: Array<{ name: string; run: () => void | Promise<void> }> = [
    {
      name: "merge occurrences match mergedFrom length",
      run: () => {
        const { candidates } = mergeEvidence(
          [
            makeHypothesis({ id: "h1" }),
            makeHypothesis({ id: "h2" }),
            makeHypothesis({ id: "h3" }),
          ],
          makeContext(),
          config,
        );
        assert.equal(candidates[0].occurrences, candidates[0].mergedFrom.length);
      },
    },
    {
      name: "merge caps evidence entries",
      run: () => {
        const evidence = Array.from({ length: 20 }, (_, index) => `src/a.ts:${index + 1}`);
        const { candidates } = mergeEvidence(
          [makeHypothesis({ id: "h1", evidence }), makeHypothesis({ id: "h2", evidence })],
          makeContext(),
          config,
        );
        assert.ok(candidates[0].evidence.length <= 8);
      },
    },
    {
      name: "merge unions tags",
      run: () => {
        const { candidates } = mergeEvidence(
          [
            makeHypothesis({ id: "h1", tags: ["auth", "rule:auth-weak-comparison"] }),
            makeHypothesis({ id: "h2", tags: ["security"] }),
          ],
          makeContext(),
          config,
        );
        assert.ok(candidates[0].tags.includes("auth"));
        assert.ok(candidates[0].tags.includes("security"));
      },
    },
    {
      name: "merge groups by symbol across files",
      run: () => {
        const { candidates } = mergeEvidence(
          [
            makeHypothesis({ id: "h1", symbol: "sharedFn", file: "src/a.ts", evidence: ["src/a.ts:1"] }),
            makeHypothesis({ id: "h2", symbol: "sharedFn", file: "src/b.ts", evidence: ["src/b.ts:2"] }),
          ],
          makeContext(),
          config,
        );
        assert.equal(candidates.length, 1);
      },
    },
    {
      name: "merge scores are non-negative",
      run: () => {
        const { candidates } = mergeEvidence(
          [makeHypothesis({ id: "h1", severity: "info", confidence: 0.3 })],
          makeContext(),
          config,
        );
        assert.ok(candidates.every((candidate) => candidate.score >= 0));
      },
    },
    {
      name: "merge produces unique ids",
      run: () => {
        const { candidates } = mergeEvidence(
          Array.from({ length: 6 }, (_, index) =>
            makeHypothesis({ id: `h${index}`, claim: `Distinct defect ${index}`, file: `src/f${index}.ts`, evidence: [`src/f${index}.ts:1`] }),
          ),
          makeContext(),
          config,
        );
        assert.equal(new Set(candidates.map((candidate) => candidate.id)).size, candidates.length);
      },
    },
    {
      name: "merge ordering is deterministic",
      run: () => {
        const input = [
          makeHypothesis({ id: "h1", severity: "high", file: "src/a.ts", evidence: ["src/a.ts:1"] }),
          makeHypothesis({ id: "h2", severity: "critical", file: "src/b.ts", evidence: ["src/b.ts:1"] }),
        ];
        const first = mergeEvidence(input, makeContext(), config).candidates;
        const second = mergeEvidence(input, makeContext(), config).candidates;
        assert.deepEqual(first.map((candidate) => candidate.id), second.map((candidate) => candidate.id));
      },
    },
    {
      name: "merge stats reflect the input size",
      run: () => {
        const input = [makeHypothesis({ id: "h1" }), makeHypothesis({ id: "h2", claim: "Consider something" })];
        const { stats } = mergeEvidence(input, makeContext(), config);
        assert.equal(stats.input, 2);
        assert.equal(stats.output, 1);
      },
    },
    {
      name: "merge dropped counts cannot be negative",
      run: () => {
        const { stats } = mergeEvidence([makeHypothesis({ id: "h1" })], makeContext(), config);
        assert.ok(stats.dropped >= 0);
      },
    },
    {
      name: "merge honours overridden candidate caps",
      run: () => {
        const { candidates } = mergeEvidence(
          Array.from({ length: 12 }, (_, index) =>
            makeHypothesis({ id: `h${index}`, claim: `Distinct defect ${index}`, file: `src/f${index}.ts`, evidence: [`src/f${index}.ts:1`] }),
          ),
          makeContext(),
          resolveConfig({ mode: "dry", judge: { maxCandidates: 3 } }),
        );
        assert.equal(candidates.length, 3);
      },
    },
    {
      name: "judge tiny budget limits proofs",
      run: () => {
        const candidates = Array.from({ length: 5 }, (_, index) => makeCandidate({ id: `c${index}`, score: 5 - index }));
        const decisions = deterministicJudge(candidates, makeContext({ size: "tiny" }), config);
        assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, config.judge.maxToProve);
      },
    },
    {
      name: "judge complex budget limits proofs",
      run: () => {
        const candidates = Array.from({ length: 8 }, (_, index) => makeCandidate({ id: `c${index}`, score: 8 - index }));
        const decisions = deterministicJudge(candidates, makeContext({ size: "complex" }), config);
        assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, config.judge.maxToProveComplex);
      },
    },
    {
      name: "judge normal budget limits proofs",
      run: () => {
        const candidates = Array.from({ length: 6 }, (_, index) => makeCandidate({ id: `c${index}`, score: 6 - index }));
        const decisions = deterministicJudge(candidates, makeContext({ size: "normal" }), config);
        assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, config.judge.maxToProve);
      },
    },
    {
      name: "judge downgrades below-bar proofs",
      run: () => {
        const decisions = deterministicJudge([makeCandidate({ id: "c1", confidence: 0.3 })], makeContext(), config);
        assert.notEqual(decisions[0].verdict, "PROVE");
      },
    },
    {
      name: "judge keeps unprovable rules static",
      run: () => {
        const decisions = deterministicJudge(
          [makeCandidate({ id: "c1", tags: ["rule:config-insecure-default"] })],
          makeContext(),
          config,
        );
        assert.equal(decisions[0].verdict, "STATIC_ONLY");
      },
    },
    {
      name: "judge attaches probe commands to proofs",
      run: () => {
        const decisions = deterministicJudge([makeCandidate({ id: "c1" })], makeContext(), config, { probeCommands: true });
        assert.equal(decisions[0].reproductionCommand, "cortado-probe c1");
      },
    },
    {
      name: "judge enforcement drops unknown ids",
      run: () => {
        const decisions = enforceJudgePolicy(
          [{ hypothesisId: "ghost", verdict: "PROVE", reason: "x", priority: 1 }],
          [makeCandidate({ id: "c1" })],
          makeContext(),
          config,
          false,
        );
        assert.ok(decisions.every((decision) => decision.hypothesisId !== "ghost"));
      },
    },
    {
      name: "judge enforcement fills missing ids",
      run: () => {
        const decisions = enforceJudgePolicy([], [makeCandidate({ id: "c1" })], makeContext(), config, false);
        assert.equal(decisions.length, 1);
      },
    },
    {
      name: "judge enforcement collapses duplicates",
      run: () => {
        const modelDecisions: JudgeDecision[] = [
          { hypothesisId: "c1", verdict: "PROVE", reason: "a", priority: 1 },
          { hypothesisId: "c1", verdict: "DISCARD", reason: "b", priority: 2 },
        ];
        const decisions = enforceJudgePolicy(modelDecisions, [makeCandidate({ id: "c1" })], makeContext(), config, false);
        assert.equal(decisions.length, 1);
      },
    },
    {
      name: "judge enforcement is idempotent",
      run: () => {
        const candidates = [makeCandidate({ id: "c1" }), makeCandidate({ id: "c2", claim: "Other defect", file: "src/b.ts", evidence: ["src/b.ts:2"] })];
        const modelDecisions: JudgeDecision[] = [
          { hypothesisId: "c1", verdict: "PROVE", reason: "a", priority: 2 },
          { hypothesisId: "c2", verdict: "PROVE", reason: "b", priority: 1 },
        ];
        const once = enforceJudgePolicy(modelDecisions, candidates, makeContext(), config, false);
        const twice = deterministicJudge(candidates, makeContext(), config);
        assert.equal(once.filter((decision) => decision.verdict === "PROVE").length, twice.filter((decision) => decision.verdict === "PROVE").length);
      },
    },
    {
      name: "proof evaluation matches a failing reproduction",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 1 })), "match");
      },
    },
    {
      name: "proof evaluation refutes a clean run",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 0 })), "refute");
      },
    },
    {
      name: "proof evaluation matches markers",
      run: () => {
        assert.equal(
          evaluateStep(step({ expectation: "marker", marker: "CORTADO_VULNERABLE" }), commandResult("x", { stdout: "CORTADO_VULNERABLE" })),
          "match",
        );
      },
    },
    {
      name: "proof evaluation refutes safe markers",
      run: () => {
        assert.equal(
          evaluateStep(step({ expectation: "marker", marker: "CORTADO_VULNERABLE" }), commandResult("x", { stdout: "CORTADO_SAFE", exitCode: 0 })),
          "refute",
        );
      },
    },
    {
      name: "proof evaluation treats timeouts as inconclusive",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 124, timedOut: true })), "inconclusive");
      },
    },
    {
      name: "proof evaluation treats missing commands as inconclusive",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 127, stderr: "not found" })), "inconclusive");
      },
    },
    {
      name: "proof steps fall back to the full environment",
      run: () => {
        const steps = buildProofSteps(
          makeCandidate({ file: "src/a.ts" }),
          { hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1 },
          [],
          DEFAULT_REPO_COMMANDS,
        );
        assert.deepEqual(steps.map((item) => item.strategy), ["full_environment"]);
      },
    },
    {
      name: "proof steps order strategies cheap first",
      run: () => {
        const steps = buildProofSteps(
          makeCandidate({ file: "src/a.ts", symbol: "run" }),
          { hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1, reproductionCommand: "cortado-probe c1" },
          ["src/a.test.ts"],
          DEFAULT_REPO_COMMANDS,
        );
        assert.deepEqual(steps.map((item) => item.strategy), ["existing_test", "targeted_test", "script"]);
      },
    },
    {
      name: "proof executions respect the hypothesis cap",
      run: async () => {
        const sandbox = new MemorySandbox({
          files: { "src/a.ts": "x" },
          handler: (command) => commandResult(command, { exitCode: 1 }),
        });
        const candidates = Array.from({ length: 5 }, (_, index) =>
          makeCandidate({ id: `c${index}`, file: `src/a${index}.ts`, evidence: [`src/a${index}.ts:1`] }),
        );
        const decisions: JudgeDecision[] = candidates.map((candidate, index) => ({
          hypothesisId: candidate.id,
          verdict: "PROVE",
          reason: "",
          priority: index + 1,
          reproductionCommand: `cortado-probe ${candidate.id}`,
        }));
        const proofs = await proveCandidates(candidates, decisions, makeContext(), {
          sandbox,
          config: resolveConfig({ mode: "dry", proof: { maxHypotheses: 2 } }),
          commands: DEFAULT_REPO_COMMANDS,
          logger: silentLogger,
        });
        assert.equal(proofs.length, 2);
      },
    },
    {
      name: "proof disproves non-reproducing claims",
      run: async () => {
        const sandbox = new MemorySandbox({
          files: { "src/a.ts": "x" },
          handler: (command) => commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE" }),
        });
        const proofs = await proveCandidates(
          [makeCandidate({ id: "c1", file: "src/a.ts" })],
          [{ hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1, reproductionCommand: "cortado-probe c1" }],
          makeContext(),
          { sandbox, config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
        );
        assert.equal(proofs[0].status, "disproven");
      },
    },
    {
      name: "safety flags workflow edits",
      run: () => assert.equal(safety("", ".github/workflows/deploy.yml").length, 1),
    },
    {
      name: "safety flags dotenv files",
      run: () => assert.equal(safety("", ".env").length, 1),
    },
    {
      name: "safety flags dotenv variants",
      run: () => assert.equal(safety("", ".env.local").length, 1),
    },
    {
      name: "safety flags npm lockfiles",
      run: () => assert.equal(safety("", "package-lock.json").length, 1),
    },
    {
      name: "safety flags yarn lockfiles",
      run: () => assert.equal(safety("", "yarn.lock").length, 1),
    },
    {
      name: "safety flags pnpm lockfiles",
      run: () => assert.equal(safety("", "pnpm-lock.yaml").length, 1),
    },
    {
      name: "safety flags removed assertions",
      run: () => {
        const findings = safety("", "src/a.test.ts", ["expect(run()).toBe(1);"]);
        assert.ok(findings.some((finding) => finding.reason.includes("test assertions")));
      },
    },
    {
      name: "safety allows added assertions",
      run: () => {
        const findings = safety("", "src/a.test.ts", ["expect(run()).toBe(1);"], ["expect(run()).toBe(1);", "expect(run()).toBe(2);"]);
        assert.deepEqual(findings, []);
      },
    },
    {
      name: "safety flags destructive SQL",
      run: () => {
        const findings = safety("DROP TABLE users;", "migrations/001.sql", [], ["DROP TABLE users;"]);
        assert.ok(findings.some((finding) => finding.reason.includes("destructive")));
      },
    },
    {
      name: "safety allows ordinary patches",
      run: () => assert.deepEqual(safety("", "src/app.ts", ["const a = 1;"], ["const a = 2;"]), []),
    },
  ];

  assert.equal(cases.length, 40);
  return defineCases("pipeline-deep", cases);
}
