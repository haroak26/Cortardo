import type { CortadoConfig } from "../config";
import type {
  MergedCandidate,
  PRContext,
  ProofResult,
  RepairResult,
  VerificationReport,
  VerificationStep,
} from "../types";
import { isTestPath } from "./change-intelligence";
import { discoverTests, type RepoCommands } from "./proof";
import type { Sandbox } from "../sandbox";
import type { Logger } from "../util/logger";

export interface VerificationDeps {
  sandbox: Sandbox;
  config: CortadoConfig;
  commands: RepoCommands;
  logger: Logger;
  now?: () => number;
}

export async function verifyRepairs(
  repairs: RepairResult[],
  candidates: MergedCandidate[],
  proofs: ProofResult[],
  context: PRContext,
  deps: VerificationDeps,
): Promise<Map<string, VerificationReport>> {
  const now = deps.now ?? (() => Date.now());
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const proofById = new Map(proofs.map((proof) => [proof.candidateId, proof]));
  const reports = new Map<string, VerificationReport>();

  for (const repair of repairs) {
    if (repair.exit !== "VERIFIED") continue;
    const candidate = byId.get(repair.candidateId);
    if (!candidate) continue;
    const startedMs = now();
    const steps: VerificationStep[] = [];
    const proof = proofById.get(repair.candidateId);
    const targeted = await discoverTests(candidate, context, deps.sandbox);
    const changedLanguages = new Set(context.files.map((file) => file.language));
    let elapsed = 0;

    const runStep = async (
      kind: VerificationStep["kind"],
      command: string,
      reason: string,
      evaluate: (result: { exitCode: number; timedOut: boolean; stdout: string; stderr: string }) => boolean,
      skipped = false,
    ) => {
      if (skipped || elapsed > deps.config.verify.totalMs) {
        steps.push({
          kind,
          command,
          passed: skipped,
          skipped: true,
          reason: skipped ? reason : "verification budget exhausted",
          durationMs: 0,
        });
        return;
      }
      const stepStarted = now();
      const result = await deps.sandbox.exec(command, { timeoutMs: 30_000, allowFailure: true });
      const duration = now() - stepStarted;
      elapsed += duration;
      steps.push({
        kind,
        command,
        passed: evaluate(result),
        skipped: false,
        reason,
        durationMs: duration,
        output: `${result.stdout}${result.stderr}`.slice(0, 2000),
      });
    };

    if (proof?.strategy === "script" && proof.command) {
      await runStep(
        "reproduction",
        proof.command,
        "Probe must report the defect is gone",
        (result) => !result.timedOut && `${result.stdout}${result.stderr}`.includes("CORTADO_SAFE"),
      );
    } else if (proof?.command) {
      await runStep(
        "reproduction",
        proof.command,
        "The failing reproduction must now pass",
        (result) => !result.timedOut && result.exitCode === 0,
      );
    } else {
      await runStep("reproduction", "", "No reproduction command recorded", () => true, true);
    }

    const targetedCommand = targeted[0] ? deps.commands.testSingle(targeted[0]) : deps.commands.test;
    await runStep(
      "targeted_tests",
      targetedCommand,
      targeted[0] ? `Run the tests covering ${targeted[0]}` : "Run the closest available test command",
      (result) => !result.timedOut && result.exitCode === 0,
    );

    const affected = context.tests.filter((test) => !targeted.includes(test) && !isTestPath(candidate.file ?? ""));
    const affectedCommand = affected[0] ? deps.commands.testSingle(affected[0]) : deps.commands.test;
    await runStep(
      "affected_tests",
      affectedCommand,
      affected[0] ? `Run affected tests (${affected.slice(0, 2).join(", ")})` : "No other affected tests detected",
      (result) => !result.timedOut && result.exitCode === 0,
      affected.length === 0 || context.size === "tiny",
    );

    const needsTypecheck =
      (changedLanguages.has("TypeScript") || changedLanguages.has("JavaScript")) &&
      context.size !== "tiny" &&
      !!deps.commands.typecheck;
    await runStep(
      "typecheck",
      deps.commands.typecheck ?? "",
      needsTypecheck ? "Type-check the repository" : "Skipped: no typed language changes or project is tiny",
      (result) => !result.timedOut && result.exitCode === 0,
      !needsTypecheck,
    );

    const needsBuild = !!deps.commands.build && context.size === "complex";
    await runStep(
      "build",
      deps.commands.build ?? "",
      needsBuild ? "Build the project" : "Skipped: change is not complex enough to warrant a build",
      (result) => !result.timedOut && result.exitCode === 0,
      !needsBuild,
    );

    const executed = steps.filter((step) => !step.skipped);
    reports.set(repair.candidateId, {
      passed: executed.length > 0 && executed.every((step) => step.passed),
      steps,
      durationMs: now() - startedMs,
    });
    deps.logger.debug(`verified ${repair.candidateId}`, { passed: reports.get(repair.candidateId)?.passed });
  }

  return reports;
}
