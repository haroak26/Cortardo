import assert from "node:assert/strict";
import { mergeEvidence } from "../../../src/stages/evidence-merge";
import { deterministicJudge } from "../../../src/judge-policy";
import { enforceJudgePolicy } from "../../../src/stages/judge";
import { buildProofSteps, evaluateStep, proveCandidates, discoverTests, DEFAULT_REPO_COMMANDS } from "../../../src/stages/proof";
import { repairFindings, patchLines } from "../../../src/stages/repair";
import { ModelRouter } from "../../../src/models/router";
import { MemorySandbox } from "../../../src/sandbox";
import { commandResult } from "../../../src/sandbox/types";
import { assessPatchSafety } from "../../../src/sandbox/safety";
import { SimulatedClock } from "../../../src/util/clock";
import { silentLogger } from "../../../src/util/logger";
import { makeUnifiedDiff } from "../../../src/util/diff";
import { makeCandidate, makeContext, makeHypothesis, makeProof } from "../../helpers/factories";
import { defineCases } from "../types";
import { ScriptedModel, diagnosisResponse, patchResponse, planResponse } from "../scripted-model";
import { resolveConfig } from "../../../src/config";
import type { Hypothesis, JudgeDecision, ProofStep } from "../../../src/types";

const config = resolveConfig({ mode: "dry" });

function merge(hypotheses: Hypothesis[]) {
  return mergeEvidence(hypotheses, makeContext(), config);
}

function step(overrides: Partial<ProofStep> = {}): ProofStep {
  return {
    strategy: overrides.strategy ?? "existing_test",
    command: overrides.command ?? "npm test -- a.test.ts",
    expectation: overrides.expectation ?? "fail",
    marker: overrides.marker,
    description: overrides.description ?? "desc",
  };
}

function evidenceCases() {
  return [
    {
      name: "identical claims merge into one corroborated candidate",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", agent: "luna-bug" }),
          makeHypothesis({ id: "h2", agent: "luna-security" }),
          makeHypothesis({ id: "h3", agent: "luna-auth" }),
        ]);
        assert.equal(candidates.length, 1);
        assert.equal(candidates[0].occurrences, 3);
        assert.equal(candidates[0].mergedFrom.length, 3);
      },
    },
    {
      name: "claims on different files stay separate",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", file: "src/a.ts", evidence: ["src/a.ts:1"] }),
          makeHypothesis({ id: "h2", file: "src/b.ts", evidence: ["src/b.ts:1"] }),
        ]);
        assert.equal(candidates.length, 2);
      },
    },
    {
      name: "merging keeps the highest severity",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", severity: "low" }),
          makeHypothesis({ id: "h2", severity: "critical" }),
        ]);
        assert.equal(candidates[0].severity, "critical");
      },
    },
    {
      name: "merging keeps the highest confidence",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", confidence: 0.3 }),
          makeHypothesis({ id: "h2", confidence: 0.95 }),
        ]);
        assert.equal(candidates[0].confidence, 0.95);
      },
    },
    {
      name: "evidence unions deduplicate entries",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", evidence: ["src/a.ts:1", "src/a.ts:2"] }),
          makeHypothesis({ id: "h2", evidence: ["src/a.ts:2", "src/a.ts:3"] }),
        ]);
        assert.deepEqual(candidates[0].evidence.sort(), ["src/a.ts:1", "src/a.ts:2", "src/a.ts:3"]);
      },
    },
    {
      name: "tags union across merged observations",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", tags: ["bug", "rule:sql-injection"] }),
          makeHypothesis({ id: "h2", tags: ["security", "rule:sql-injection"] }),
        ]);
        assert.ok(candidates[0].tags.includes("bug"));
        assert.ok(candidates[0].tags.includes("security"));
      },
    },
    {
      name: "generic claims are dropped",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", claim: "Consider adding more tests" }),
          makeHypothesis({ id: "h2", claim: "Real defect in the session check" }),
        ]);
        assert.equal(candidates.length, 1);
      },
    },
    {
      name: "short claims are dropped",
      run: () => {
        const { candidates } = merge([makeHypothesis({ id: "h1", claim: "oops" })]);
        assert.equal(candidates.length, 0);
      },
    },
    {
      name: "low confidence claims are dropped",
      run: () => {
        const { candidates } = merge([makeHypothesis({ id: "h1", confidence: 0.1 })]);
        assert.equal(candidates.length, 0);
      },
    },
    {
      name: "weak info claims are dropped",
      run: () => {
        const { candidates } = merge([
          makeHypothesis({ id: "h1", severity: "info", confidence: 0.4 }),
        ]);
        assert.equal(candidates.length, 0);
      },
    },
    {
      name: "candidate count is capped",
      run: () => {
        const { candidates } = merge(
          Array.from({ length: 30 }, (_, index) =>
            makeHypothesis({
              id: `h${index}`,
              claim: `Distinct defect number ${index} in module ${index}`,
              file: `src/module-${index}.ts`,
              evidence: [`src/module-${index}.ts:1`],
            }),
          ),
        );
        assert.equal(candidates.length, config.judge.maxCandidates);
      },
    },
    {
      name: "merge output is deterministic and score ordered",
      run: () => {
        const input = [
          makeHypothesis({ id: "h1", severity: "low", file: "src/a.ts", evidence: ["src/a.ts:9"] }),
          makeHypothesis({ id: "h2", severity: "critical", file: "src/b.ts", evidence: ["src/b.ts:1"] }),
        ];
        const first = merge(input).candidates;
        const second = merge(input).candidates;
        assert.deepEqual(first.map((candidate) => candidate.id), second.map((candidate) => candidate.id));
        assert.equal(first[0].severity, "critical");
        assert.ok(first[0].score >= first[1].score);
      },
    },
  ];
}

function judgeCases() {
  const tiny = makeContext({ size: "tiny" });
  const complex = makeContext({ size: "complex" });
  const many = Array.from({ length: 8 }, (_, index) =>
    makeCandidate({ id: `c${index}`, score: 20 - index, confidence: 0.9 }),
  );
  return [
    {
      name: "tiny PRs prove at most the tiny budget",
      run: () => {
        const decisions = deterministicJudge(many, tiny, config);
        assert.equal(decisions.filter((decision) => decision.verdict === "PROVE").length, config.judge.maxToProve);
      },
    },
    {
      name: "complex PRs prove at most the complex budget",
      run: () => {
        const decisions = deterministicJudge(many, complex, config);
        assert.equal(
          decisions.filter((decision) => decision.verdict === "PROVE").length,
          config.judge.maxToProveComplex,
        );
      },
    },
    {
      name: "low severity candidates are not proved",
      run: () => {
        const decisions = deterministicJudge([makeCandidate({ severity: "low" })], tiny, config);
        assert.notEqual(decisions[0].verdict, "PROVE");
      },
    },
    {
      name: "low confidence candidates are not proved",
      run: () => {
        const decisions = deterministicJudge([makeCandidate({ confidence: 0.4 })], tiny, config);
        assert.notEqual(decisions[0].verdict, "PROVE");
      },
    },
    {
      name: "hopeless candidates are discarded",
      run: () => {
        const decisions = deterministicJudge(
          [makeCandidate({ severity: "info", confidence: 0.1 })],
          tiny,
          config,
        );
        assert.equal(decisions[0].verdict, "DISCARD");
      },
    },
    {
      name: "unprovable rules become static only",
      run: () => {
        const decisions = deterministicJudge(
          [makeCandidate({ tags: ["regression", "rule:removed-test-coverage"] })],
          tiny,
          config,
        );
        assert.equal(decisions[0].verdict, "STATIC_ONLY");
      },
    },
    {
      name: "probe commands are attached only to proofs",
      run: () => {
        const decisions = deterministicJudge([makeCandidate({ id: "c1" })], tiny, config, {
          probeCommands: true,
        });
        assert.equal(decisions[0].reproductionCommand, "cortado-probe c1");
      },
    },
    {
      name: "unknown decisions are dropped",
      run: () => {
        const decisions = enforceJudgePolicy(
          [{ hypothesisId: "ghost", verdict: "PROVE", reason: "x", priority: 1 }],
          [makeCandidate({ id: "c1" })],
          tiny,
          config,
          false,
        );
        assert.equal(decisions.length, 1);
        assert.equal(decisions[0].hypothesisId, "c1");
      },
    },
    {
      name: "missing decisions are filled deterministically",
      run: () => {
        const decisions = enforceJudgePolicy(
          [],
          [makeCandidate({ id: "c1" })],
          tiny,
          config,
          false,
        );
        assert.equal(decisions.length, 1);
        assert.equal(decisions[0].reason.includes("No decision returned"), true);
      },
    },
    {
      name: "duplicate decisions collapse to one",
      run: () => {
        const modelDecisions: JudgeDecision[] = [
          { hypothesisId: "c1", verdict: "PROVE", reason: "a", priority: 1 },
          { hypothesisId: "c1", verdict: "DISCARD", reason: "b", priority: 2 },
        ];
        const decisions = enforceJudgePolicy(modelDecisions, [makeCandidate({ id: "c1" })], tiny, config, false);
        assert.equal(decisions.length, 1);
      },
    },
    {
      name: "proof priorities are unique after enforcement",
      run: () => {
        const candidates = [
          makeCandidate({ id: "c1" }),
          makeCandidate({ id: "c2", claim: "Second defect", file: "src/b.ts", evidence: ["src/b.ts:2"] }),
        ];
        const decisions = enforceJudgePolicy(
          [
            { hypothesisId: "c1", verdict: "PROVE", reason: "a", priority: 4 },
            { hypothesisId: "c2", verdict: "PROVE", reason: "b", priority: 4 },
          ],
          candidates,
          tiny,
          config,
          false,
        );
        const priorities = decisions
          .filter((decision) => decision.verdict === "PROVE")
          .map((decision) => decision.priority);
        assert.equal(new Set(priorities).size, priorities.length);
      },
    },
    {
      name: "judge policy is idempotent",
      run: () => {
        const first = deterministicJudge(many, complex, config);
        const second = deterministicJudge(many, complex, config);
        assert.deepEqual(first, second);
      },
    },
  ];
}

function proofCases() {
  return [
    {
      name: "failing tests reproduce a claim",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 1 })), "match");
      },
    },
    {
      name: "passing tests refute a claim",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 0 })), "refute");
      },
    },
    {
      name: "timed out proofs are inconclusive",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 124, timedOut: true })), "inconclusive");
      },
    },
    {
      name: "missing commands are inconclusive",
      run: () => {
        assert.equal(evaluateStep(step(), commandResult("x", { exitCode: 127, stderr: "command not found" })), "inconclusive");
      },
    },
    {
      name: "pass expectations accept success",
      run: () => {
        assert.equal(evaluateStep(step({ expectation: "pass" }), commandResult("x", { exitCode: 0 })), "match");
      },
    },
    {
      name: "pass expectations reject failure",
      run: () => {
        assert.equal(evaluateStep(step({ expectation: "pass" }), commandResult("x", { exitCode: 1 })), "refute");
      },
    },
    {
      name: "marker expectations match the marker",
      run: () => {
        assert.equal(
          evaluateStep(step({ expectation: "marker", marker: "CORTADO_VULNERABLE" }), commandResult("x", { stdout: "CORTADO_VULNERABLE" })),
          "match",
        );
      },
    },
    {
      name: "marker expectations refute a clean exit",
      run: () => {
        assert.equal(
          evaluateStep(step({ expectation: "marker", marker: "CORTADO_VULNERABLE" }), commandResult("x", { exitCode: 0, stdout: "CORTADO_SAFE" })),
          "refute",
        );
      },
    },
    {
      name: "marker expectations are inconclusive on crashes",
      run: () => {
        assert.equal(
          evaluateStep(step({ expectation: "marker", marker: "CORTADO_VULNERABLE" }), commandResult("x", { exitCode: 1, stdout: "boom" })),
          "inconclusive",
        );
      },
    },
    {
      name: "proof strategies are ordered cheap first",
      run: () => {
        const steps = buildProofSteps(
          makeCandidate({ file: "src/app.ts", symbol: "run" }),
          { hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1, reproductionCommand: "cortado-probe c1" },
          ["src/app.test.ts"],
          DEFAULT_REPO_COMMANDS,
        );
        assert.deepEqual(steps.map((item) => item.strategy), ["existing_test", "targeted_test", "script"]);
      },
    },
    {
      name: "proof falls back to the full environment without tests",
      run: () => {
        const steps = buildProofSteps(
          makeCandidate({ file: "src/app.ts" }),
          { hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1 },
          [],
          DEFAULT_REPO_COMMANDS,
        );
        assert.deepEqual(steps.map((item) => item.strategy), ["full_environment"]);
      },
    },
    {
      name: "test discovery scans the sandbox when the context is empty",
      run: async () => {
        const sandbox = new MemorySandbox({
          files: { "server/auth/session.test.ts": "", "server/other.test.ts": "" },
        });
        const tests = await discoverTests(makeCandidate({ file: "server/auth/session.ts" }), makeContext(), sandbox);
        assert.deepEqual(tests, ["server/auth/session.test.ts"]);
      },
    },
    {
      name: "confirmed proofs report the reproduction",
      run: async () => {
        const results = await proofWith((command) =>
          command.includes("probe")
            ? commandResult(command, { stdout: "CORTADO_VULNERABLE" })
            : commandResult(command, { exitCode: 1, stderr: "AssertionError" }),
        );
        assert.equal(results[0].status, "confirmed");
        assert.ok(results[0].reproduction);
      },
    },
    {
      name: "all-pass experiments disprove a claim",
      run: async () => {
        const results = await proofWith((command) =>
          command.includes("probe")
            ? commandResult(command, { stdout: "CORTADO_SAFE" })
            : commandResult(command, { exitCode: 0 }),
        );
        assert.equal(results[0].status, "disproven");
      },
    },
    {
      name: "unsettled experiments produce an error",
      run: async () => {
        const results = await proofWith((command) => commandResult(command, { exitCode: 124, timedOut: true }));
        assert.equal(results[0].status, "error");
      },
    },
    {
      name: "proof budget exhaustion is reported per hypothesis",
      run: async () => {
        const clock = new SimulatedClock(0, 10_000);
        const sandbox = new MemorySandbox({ files: { "src/app.ts": "x" } });
        const results = await proveCandidates(
          [makeCandidate({ id: "c1", file: "src/app.ts" })],
          [{ hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1 }],
          makeContext(),
          {
            sandbox,
            config: resolveConfig({ mode: "dry", proof: { totalMs: 1 } }),
            commands: DEFAULT_REPO_COMMANDS,
            logger: silentLogger,
            now: () => clock.now(),
          },
        );
        assert.equal(results[0].status, "error");
        assert.match(results[0].explanation, /budget/);
      },
    },
  ];
}

function proofWith(handler: (command: string) => ReturnType<typeof commandResult>) {
  const sandbox = new MemorySandbox({
    files: { "src/app.ts": "content", "src/app.test.ts": "test" },
    handler: (command) => handler(command),
  });
  return proveCandidates(
    [makeCandidate({ id: "c1", file: "src/app.ts" })],
    [{ hypothesisId: "c1", verdict: "PROVE", reason: "", priority: 1, reproductionCommand: "cortado-probe c1" }],
    makeContext({ tests: ["src/app.test.ts"] }),
    { sandbox, config, commands: DEFAULT_REPO_COMMANDS, logger: silentLogger },
  );
}

function repairCases() {
  const fixPatch = makeUnifiedDiff("src/app.ts", "const value = 1;\n", "const value = 2;\n");
  const noopPatch = makeUnifiedDiff("src/app.ts", "const value = 1;\n", "// guard\nconst value = 1;\n");

  const routerWith = (scripted: ScriptedModel) =>
    new ModelRouter({ config: config.models, mode: "dry", luna: scripted, terra: scripted, astra: scripted });

  const fixedHandler = (command: string, files: Record<string, string>) => {
    const fixed = (files["src/app.ts"] ?? "").includes("const value = 2");
    if (command.startsWith("cortado-probe")) {
      return fixed
        ? commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE" })
        : commandResult(command, { exitCode: 1, stdout: "CORTADO_VULNERABLE" });
    }
    return fixed ? commandResult(command, { exitCode: 0 }) : commandResult(command, { exitCode: 1, stderr: "AssertionError" });
  };

  const runRepair = (
    scripted: ScriptedModel,
    options: { handler?: (command: string, files: Record<string, string>) => ReturnType<typeof commandResult>; config?: typeof config } = {},
  ) =>
    repairFindings(
      [makeProof({ candidateId: "c1", status: "confirmed", strategy: "script", command: "cortado-probe c1" })],
      [makeCandidate({ id: "c1", file: "src/app.ts" })],
      makeContext({ tests: ["src/app.test.ts"] }),
      {
        sandbox: new MemorySandbox({
          files: { "src/app.ts": "const value = 1;\n", "src/app.test.ts": "test" },
          handler: (command, files) => (options.handler ? options.handler(command, files) : fixedHandler(command, files)),
        }),
        models: routerWith(scripted),
        config: options.config ?? config,
        commands: DEFAULT_REPO_COMMANDS,
        logger: silentLogger,
      },
    );

  return [
    {
      name: "patch safety rejects workflow edits",
      run: () => {
        const findings = repairSafety("--- a/.github/workflows/ci.yml\n+++ b/.github/workflows/ci.yml\n");
        assert.equal(findings.length, 1);
      },
    },
    {
      name: "patch safety rejects env files",
      run: () => {
        assert.equal(repairSafety("", ".env").length, 1);
      },
    },
    {
      name: "patch safety rejects lockfiles",
      run: () => {
        assert.ok(repairSafety("", "package-lock.json").length >= 1);
        assert.ok(repairSafety("", "yarn.lock").length >= 1);
      },
    },
    {
      name: "patch safety rejects removed assertions",
      run: () => {
        const findings = assessPatch("[removed:expect(run()).toBe(1);]", "src/app.test.ts");
        assert.ok(findings.some((finding) => finding.reason.includes("test assertions")));
      },
    },
    {
      name: "patch safety allows ordinary fixes",
      run: () => {
        assert.deepEqual(assessPatch("[added:const value = 2;]", "src/app.ts"), []);
      },
    },
    {
      name: "patch safety rejects destructive SQL",
      run: () => {
        const findings = assessPatch("DROP TABLE users;", "migrations/001.sql");
        assert.ok(findings.some((finding) => finding.reason.includes("destructive")));
      },
    },
    {
      name: "repair verifies a working patch",
      run: async () => {
        const repairs = await runRepair(
          new ScriptedModel({ repair_plan: [planResponse()], repair_patch: [patchResponse(fixPatch)] }),
        );
        assert.equal(repairs[0].exit, "VERIFIED");
        assert.equal(repairs[0].attempts.length, 1);
      },
    },
    {
      name: "repair retries after a failed apply",
      run: async () => {
        const repairs = await runRepair(
          new ScriptedModel({
            repair_plan: [planResponse(), planResponse("second")],
            repair_patch: [patchResponse("--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-nope\n+value\n"), patchResponse(fixPatch)],
            repair_diagnosis: [diagnosisResponse()],
          }),
        );
        assert.equal(repairs[0].exit, "VERIFIED");
        assert.equal(repairs[0].attempts.length, 2);
      },
    },
    {
      name: "unsafe repair patches exit UNSAFE",
      run: async () => {
        const unsafe = makeUnifiedDiff(".github/workflows/ci.yml", "name: ci\n", "name: ci\n# off\n");
        const repairs = await runRepair(
          new ScriptedModel({ repair_plan: [planResponse()], repair_patch: [patchResponse(unsafe)] }),
        );
        assert.equal(repairs[0].exit, "UNSAFE");
      },
    },
    {
      name: "repair exits UNRESOLVED after max attempts",
      run: async () => {
        const repairs = await runRepair(
          new ScriptedModel({
            repair_plan: [planResponse(), planResponse(), planResponse()],
            repair_patch: [patchResponse(noopPatch), patchResponse(noopPatch), patchResponse(noopPatch)],
            repair_diagnosis: [diagnosisResponse(), diagnosisResponse(), diagnosisResponse()],
          }),
          { handler: (command) => commandResult(command, { exitCode: 1, stderr: "fail" }) },
        );
        assert.equal(repairs[0].exit, "UNRESOLVED");
        assert.equal(repairs[0].attempts.length, config.repair.maxAttempts);
      },
    },
    {
      name: "repair exits BUDGET_EXHAUSTED on the tool call cap",
      run: async () => {
        const repairs = await runRepair(
          new ScriptedModel({ repair_plan: [planResponse()], repair_patch: [patchResponse(noopPatch)] }),
          {
            handler: (command) => commandResult(command, { exitCode: 1, stderr: "fail" }),
            config: resolveConfig({ mode: "dry", repair: { maxToolCalls: 1 } }),
          },
        );
        assert.equal(repairs[0].exit, "BUDGET_EXHAUSTED");
      },
    },
    {
      name: "repair without files exits UNRESOLVED",
      run: async () => {
        const scripted = new ScriptedModel({});
        const repairs = await repairFindings(
          [makeProof({ candidateId: "c1", status: "confirmed" })],
          [makeCandidate({ id: "c1", file: "missing.ts" })],
          makeContext(),
          {
            sandbox: new MemorySandbox({ files: {} }),
            models: routerWith(scripted),
            config,
            commands: DEFAULT_REPO_COMMANDS,
            logger: silentLogger,
          },
        );
        assert.equal(repairs[0].exit, "UNRESOLVED");
        assert.match(repairs[0].reason, /no relevant files/);
      },
    },
    {
      name: "invalid planner output falls back safely",
      run: async () => {
        const repairs = await runRepair(
          new ScriptedModel({ repair_plan: ["garbage"], repair_patch: [patchResponse(fixPatch)] }),
        );
        assert.equal(repairs[0].exit, "VERIFIED");
      },
    },
    {
      name: "empty patches are recorded as failed attempts",
      run: async () => {
        const repairs = await runRepair(
          new ScriptedModel({
            repair_plan: [planResponse(), planResponse(), planResponse()],
            repair_patch: [patchResponse(""), patchResponse(""), patchResponse("")],
            repair_diagnosis: [diagnosisResponse(), diagnosisResponse(), diagnosisResponse()],
          }),
        );
        assert.equal(repairs[0].exit, "UNRESOLVED");
        assert.ok(repairs[0].attempts.every((attempt) => attempt.applied === false));
      },
    },
    {
      name: "patchLines reports every touched file",
      run: () => {
        const patch = makeUnifiedDiff("a.ts", "a1\n", "a2\n") + makeUnifiedDiff("b.ts", "b1\n", "b2\n");
        const lines = patchLines(patch);
        assert.deepEqual(lines.map((file) => file.path).sort(), ["a.ts", "b.ts"]);
        assert.deepEqual(lines[0].removedLines.length + lines[1].removedLines.length, 2);
      },
    },
    {
      name: "repair ignores unconfirmed proofs",
      run: async () => {
        const scripted = new ScriptedModel({});
        const repairs = await repairFindings(
          [makeProof({ candidateId: "c1", status: "disproven" })],
          [makeCandidate({ id: "c1" })],
          makeContext(),
          {
            sandbox: new MemorySandbox({ files: { "src/app.ts": "x" } }),
            models: routerWith(scripted),
            config,
            commands: DEFAULT_REPO_COMMANDS,
            logger: silentLogger,
          },
        );
        assert.equal(repairs.length, 0);
      },
    },
  ];
}

function repairSafety(patch: string, path = ".github/workflows/ci.yml") {
  return assessPatchSafety(patch, [{ path, removedLines: [], addedLines: [] }]);
}

function assessPatch(content: string, path: string) {
  return assessPatchSafety(content, [
    {
      path,
      removedLines: content.startsWith("[removed:") ? [content.slice(9, -1)] : [],
      addedLines: content.startsWith("[added:") ? [content.slice(7, -1)] : [],
    },
  ]);
}

export function buildPipelineGroup() {
  return defineCases("pipeline", [...evidenceCases(), ...judgeCases(), ...proofCases(), ...repairCases()]);
}
