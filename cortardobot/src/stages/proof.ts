import type { CortadoConfig } from "../config";
import type {
  JudgeDecision,
  MergedCandidate,
  PRContext,
  ProofAttempt,
  ProofResult,
  ProofStatus,
  ProofStep,
  ProofStrategy,
} from "../types";
import { isTestPath } from "./change-intelligence";
import { truncate } from "../util/text";
import type { Sandbox } from "../sandbox";
import type { Logger } from "../util/logger";

export interface RepoCommands {
  test: string;
  testSingle: (file: string) => string;
  typecheck?: string;
  build?: string;
}

export const DEFAULT_REPO_COMMANDS: RepoCommands = {
  test: "npm test",
  testSingle: (file: string) => `npm test -- ${file}`,
  typecheck: "npx tsc --noEmit",
  build: "npm run build",
};

export interface ProofDeps {
  sandbox: Sandbox;
  config: CortadoConfig;
  commands: RepoCommands;
  logger: Logger;
  now?: () => number;
}

export function basenameStem(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[cm]?[jt]sx?$/, "").replace(/\.py$/, "");
}

export function isTestNameMatch(testPath: string, sourcePath: string): boolean {
  const testBase = basenameStem(testPath);
  const sourceBase = basenameStem(sourcePath);
  if (!testBase || !sourceBase) return false;
  return (
    testBase === sourceBase ||
    testBase.startsWith(`${sourceBase}.`) ||
    sourceBase.startsWith(`${testBase}.`)
  );
}

export function relatedTests(candidate: MergedCandidate, context: PRContext): string[] {
  const file = candidate.file;
  if (!file) return [];
  const out = new Set<string>();
  if (isTestPath(file)) out.add(file);
  const stem = file.replace(/\.(ts|tsx|js|jsx|mjs|cjs|py)$/, "");
  for (const test of context.tests) {
    if (test === file) continue;
    if (test.includes(stem) || isTestNameMatch(test, file)) out.add(test);
  }
  for (const edge of context.dependencies) {
    if (edge.to === file && isTestPath(edge.from)) out.add(edge.from);
  }
  return [...out].slice(0, 3);
}

export async function discoverTests(
  candidate: MergedCandidate,
  context: PRContext,
  sandbox: Sandbox,
): Promise<string[]> {
  const known = relatedTests(candidate, context);
  if (known.length > 0 || !candidate.file) return known;
  try {
    const files = await sandbox.list();
    return files.filter((file) => isTestPath(file) && isTestNameMatch(file, candidate.file!)).slice(0, 3);
  } catch {
    return [];
  }
}

export function buildProofSteps(
  candidate: MergedCandidate,
  decision: JudgeDecision,
  tests: string[],
  commands: RepoCommands,
): ProofStep[] {
  const steps: ProofStep[] = [];
  for (const test of tests.slice(0, 2)) {
    steps.push({
      strategy: "existing_test",
      command: commands.testSingle(test),
      expectation: "fail",
      description: `Run existing test ${test} and expect the defect to surface`,
    });
  }
  if (candidate.symbol && tests.length > 0) {
    steps.push({
      strategy: "targeted_test",
      command: `${commands.testSingle(tests[0])} -t "${candidate.symbol}"`,
      expectation: "fail",
      description: `Run only the ${candidate.symbol} cases and expect a failure`,
    });
  }
  if (decision.reproductionCommand) {
    steps.push({
      strategy: "script",
      command: decision.reproductionCommand,
      expectation: "marker",
      marker: "CORTADO_VULNERABLE",
      description: "Run the generated probe and look for the vulnerability marker",
    });
  }
  if (steps.length === 0 && commands.test) {
    steps.push({
      strategy: "full_environment",
      command: commands.test,
      expectation: "fail",
      description: "Run the repository test suite and expect the defect to surface",
    });
  }
  return steps;
}

export async function proveCandidates(
  candidates: MergedCandidate[],
  decisions: JudgeDecision[],
  context: PRContext,
  deps: ProofDeps,
): Promise<ProofResult[]> {
  const now = deps.now ?? (() => Date.now());
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const toProve = decisions
    .filter((decision) => decision.verdict === "PROVE")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, deps.config.proof.maxHypotheses);
  const results: ProofResult[] = [];
  const startedAll = now();

  for (const decision of toProve) {
    const candidate = byId.get(decision.hypothesisId);
    if (!candidate) continue;
    const started = now();
    if (now() - startedAll > deps.config.proof.totalMs) {
      results.push({
        hypothesisId: candidate.id,
        candidateId: candidate.id,
        status: "error",
        strategy: "existing_test",
        attempts: [],
        durationMs: 0,
        explanation: "proof budget exhausted before this hypothesis could run",
      });
      continue;
    }
    const steps = buildProofSteps(
      candidate,
      decision,
      await discoverTests(candidate, context, deps.sandbox),
      deps.commands,
    ).slice(0, deps.config.proof.maxStrategies);
    const attempts: ProofAttempt[] = [];
    let matchedStep: ProofStep | undefined;
    let refutes = 0;
    let inconclusive = 0;

    for (const step of steps) {
      if (now() - started > deps.config.proof.perHypothesisMs) {
        inconclusive++;
        break;
      }
      const execStarted = now();
      const result = await deps.sandbox.exec(step.command, {
        timeoutMs: Math.min(deps.config.proof.perHypothesisMs, 30_000),
        allowFailure: true,
      });
      const evaluation = evaluateStep(step, result);
      attempts.push({
        step,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        output: truncate(`${result.stdout}\n${result.stderr}`.trim(), 2000),
        matched: evaluation === "match",
        durationMs: now() - execStarted,
      });
      if (evaluation === "match") {
        matchedStep = step;
        break;
      }
      if (evaluation === "refute") refutes++;
      else inconclusive++;
    }

    const status: ProofStatus = matchedStep
      ? "confirmed"
      : refutes > 0 && inconclusive === 0
        ? "disproven"
        : refutes === 0 && inconclusive > 0
          ? "error"
          : "likely";

    const lastAttempt = attempts[attempts.length - 1];
    results.push({
      hypothesisId: candidate.id,
      candidateId: candidate.id,
      status,
      strategy: matchedStep?.strategy ?? steps[0]?.strategy ?? "existing_test",
      attempts,
      command: matchedStep?.command,
      output: matchedStep ? lastAttempt?.output : attempts.map((attempt) => attempt.output).join("\n---\n").slice(0, 2000),
      durationMs: now() - started,
      explanation: explainProof(status, matchedStep, attempts, steps),
      reproduction: matchedStep
        ? `${matchedStep.command}\n${lastAttempt?.output ?? ""}`.trim()
        : undefined,
    });
    deps.logger.debug(`proof ${candidate.id}: ${status}`, { strategy: matchedStep?.strategy });
  }

  return results;
}

export function evaluateStep(
  step: ProofStep,
  result: { exitCode: number; timedOut: boolean; stdout: string; stderr: string },
): "match" | "refute" | "inconclusive" {
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.timedOut) return "inconclusive";
  if (result.exitCode === 127 || /command not found|is not recognized|ENOENT/i.test(output)) {
    return "inconclusive";
  }
  if (/could not read package\.json|missing script|no such file or directory|Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/i.test(output)) {
    return "inconclusive";
  }
  if (step.expectation === "fail") {
    if (result.exitCode !== 0) return "match";
    return "refute";
  }
  if (step.expectation === "pass") {
    return result.exitCode === 0 ? "match" : "refute";
  }
  if (step.marker) {
    if (output.includes(step.marker)) return "match";
    if (result.exitCode === 0) return "refute";
    return "inconclusive";
  }
  return "inconclusive";
}

function explainProof(
  status: ProofStatus,
  matched: ProofStep | undefined,
  attempts: ProofAttempt[],
  steps: ProofStep[],
): string {
  if (matched) {
    return `Reproduced with ${matched.strategy} (${attempts.length} attempt${attempts.length === 1 ? "" : "s"})`;
  }
  if (steps.length === 0) {
    return "No executable experiment was available for this finding";
  }
  const failures = attempts.filter((attempt) => attempt.timedOut).length;
  if (failures > 0) {
    return `Could not settle the claim: ${failures} execution(s) timed out or failed to start`;
  }
  if (status === "disproven") {
    return `Ran ${attempts.length} experiment(s); none reproduced the claimed behavior`;
  }
  return `Inconclusive: ${attempts.length} experiment(s) ran without a decisive result`;
}

export function strategiesFor(candidate: MergedCandidate, context: PRContext, commands: RepoCommands): ProofStrategy[] {
  const steps = buildProofSteps(
    candidate,
    { hypothesisId: candidate.id, verdict: "PROVE", reason: "", priority: 1 },
    relatedTests(candidate, context),
    commands,
  );
  return steps.map((step) => step.strategy);
}
