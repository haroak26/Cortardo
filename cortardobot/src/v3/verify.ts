import type { Candidate, PRContext, ProofResult, RepairResult, VerificationReport, VerificationStep } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import { truncate, type Logger } from "./util";

export interface VerifyDeps {
  sandbox: Sandbox;
  profile: RepoProfile;
  proveOne: (candidate: Candidate) => Promise<ProofResult>;
  baselineTypecheckPassed: boolean | undefined;
  now?: () => number;
}

export async function verifyRepairs(
  repairs: RepairResult[],
  candidates: Candidate[],
  context: PRContext,
  deps: VerifyDeps,
): Promise<Record<string, VerificationReport>> {
  const now = deps.now ?? (() => Date.now());
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reports: Record<string, VerificationReport> = {};

  for (const repair of repairs) {
    if (repair.exit !== "VERIFIED") continue;
    const candidate = byId.get(repair.candidateId);
    if (!candidate) continue;
    const started = now();
    const steps: VerificationStep[] = [];

    const proof = await deps.proveOne(candidate);
    steps.push({
      kind: "reproduction",
      command: candidate.check ? `playwright ${candidate.check.label} @ ${candidate.check.path}` : "candidate reproduction",
      passed: proof.status === "disproven" || proof.status === "likely",
      skipped: false,
      reason: proof.explanation,
      durationMs: proof.durationMs,
      output: truncate(proof.reproduction, 1200),
    });

    const relatedTests = context.tests.filter((test) => candidate.file && test.includes((candidate.file.split("/").pop() ?? "").replace(/\.[^.]+$/, "")));
    if (relatedTests.length > 0 && deps.profile.testSingle) {
      const command = deps.profile.testSingle(relatedTests[0]);
      const result = await deps.sandbox.exec(command, { cwd: deps.sandbox.root, timeoutMs: 120_000, allowFailure: true });
      steps.push({
        kind: "targeted_tests",
        command,
        passed: result.exitCode === 0 && !result.timedOut,
        skipped: false,
        reason: `tests covering ${candidate.file}`,
        durationMs: result.durationMs,
        output: truncate(`${result.stdout}\n${result.stderr}`, 1200),
      });
    } else {
      steps.push({
        kind: "targeted_tests",
        command: deps.profile.testCommand ?? "",
        passed: true,
        skipped: true,
        reason: "no repository tests cover this file",
        durationMs: 0,
      });
    }

    if (deps.profile.typecheckCommand) {
      if (deps.baselineTypecheckPassed === false) {
        steps.push({
          kind: "typecheck",
          command: deps.profile.typecheckCommand,
          passed: true,
          skipped: true,
          reason: "baseline typecheck already failing before the fix",
          durationMs: 0,
        });
      } else {
        const result = await deps.sandbox.exec(deps.profile.typecheckCommand, { cwd: deps.sandbox.root, timeoutMs: 180_000, allowFailure: true });
        steps.push({
          kind: "typecheck",
          command: deps.profile.typecheckCommand,
          passed: result.exitCode === 0 && !result.timedOut,
          skipped: false,
          reason: "type-check the repository after the fix",
          durationMs: result.durationMs,
          output: truncate(`${result.stdout}\n${result.stderr}`, 1600),
        });
      }
    }

    if (context.size === "complex" && deps.profile.buildCommand) {
      const result = await deps.sandbox.exec(deps.profile.buildCommand, { cwd: deps.sandbox.root, timeoutMs: 300_000, allowFailure: true });
      steps.push({
        kind: "build",
        command: deps.profile.buildCommand,
        passed: result.exitCode === 0 && !result.timedOut,
        skipped: false,
        reason: "build the project for a complex change",
        durationMs: result.durationMs,
        output: truncate(`${result.stdout}\n${result.stderr}`, 1600),
      });
    }

    const executed = steps.filter((step) => !step.skipped);
    reports[repair.candidateId] = {
      passed: executed.length > 0 && executed.every((step) => step.passed),
      steps,
      durationMs: now() - started,
    };
  }

  return reports;
}
