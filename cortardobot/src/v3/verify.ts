import type { Candidate, PRContext, ProofResult, RepairResult, VerificationReport, VerificationStep } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import { truncate, type Logger } from "./util";
import { relatedTestsFor } from "./test-index";

export { relatedTestsFor };

export type BaselineStatus = "green" | "red" | "unavailable" | "timeout";

export interface BaselineTestResult {
  status: BaselineStatus;
  output: string;
}

export interface VerifyDeps {
  sandbox: Sandbox;
  profile: RepoProfile;
  proveOne: (candidate: Candidate) => Promise<ProofResult>;
  /**
   * Optional batch proof. When present every candidate is proven in one batch
   * (a single app boot for browser checks) instead of one boot per candidate.
   */
  proveMany?: (candidates: Candidate[]) => Promise<ProofResult[]>;
  /**
   * Baseline typecheck captured on the pristine head (3.3). Only a genuinely
   * red baseline may skip the post-fix check; timeouts/unavailable still run.
   */
  baselineTypecheck?: BaselineStatus;
  /** Baseline full test-suite result captured on the pristine head (3.3). */
  baselineTests?: BaselineTestResult | undefined;
  logger?: Logger;
  now?: () => number;
  /** Cancellation signal from the owning stage (3.3). */
  signal?: AbortSignal;
}

interface CommandOutcome {
  passed: boolean;
  output: string;
  durationMs: number;
  /** True when a failed first run was retried once (3.2 flake handling). */
  reran?: boolean;
  /** True when the retry passed after the first run failed. */
  flaky?: boolean;
}

/** True when a failed first run was retried once (3.2 flake handling). */
function flakeNote(outcome: CommandOutcome): string {
  if (!outcome.reran) return "";
  return outcome.flaky ? " (flake: failed first run, passed on re-run)" : " (failed twice)";
}

/**
 * Verification is stricter than proof: a repair is only verified when the
 * authoritative reproduction is disproven (never "likely"/"error") and every
 * executed step passes. Inconclusive steps are failures here.
 *
 * 3.2 batches the expensive work: one app boot for every browser proof, one
 * typecheck, one build and one run per unique targeted test command, shared
 * across all repairs that need them.
 */
export async function verifyRepairs(
  repairs: RepairResult[],
  candidates: Candidate[],
  context: PRContext,
  deps: VerifyDeps,
): Promise<Record<string, VerificationReport>> {
  const now = deps.now ?? (() => Date.now());
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const reports: Record<string, VerificationReport> = {};

  const eligible: Array<{ repair: RepairResult; candidate: Candidate }> = [];
  for (const repair of repairs) {
    if (repair.exit !== "VERIFIED") continue;
    const candidate = byId.get(repair.candidateId);
    if (!candidate) continue;
    if (!repair.finalPatch || !repair.finalPatch.includes("@@")) {
      reports[repair.candidateId] = {
        passed: false,
        durationMs: 0,
        steps: [
          {
            kind: "reproduction",
            command: "patch invariant",
            passed: false,
            skipped: false,
            reason: "repair was marked verified but produced no patch hunks",
            durationMs: 0,
          },
        ],
      };
      continue;
    }
    eligible.push({ repair, candidate });
  }
  if (eligible.length === 0) return reports;

  const started = now();

  // 1. Reproduction: one batch (single app boot) when the caller supports it.
  const proofById = new Map<string, ProofResult>();
  if (deps.proveMany) {
    try {
      const results = await deps.proveMany(eligible.map((entry) => entry.candidate));
      for (const result of results) proofById.set(result.candidateId, result);
    } catch (error) {
      deps.logger?.warn("batch proof failed; falling back to per-candidate proofs", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  for (const entry of eligible) {
    if (proofById.has(entry.candidate.id)) continue;
    try {
      proofById.set(entry.candidate.id, await deps.proveOne(entry.candidate));
    } catch (error) {
      proofById.set(entry.candidate.id, {
        candidateId: entry.candidate.id,
        status: "error",
        strategy: "none",
        attempts: [],
        reproduction: `proof failed to run: ${error instanceof Error ? error.message : String(error)}`,
        explanation: `proof failed to run: ${error instanceof Error ? error.message : String(error)}`,
        durationMs: 0,
      });
    }
  }

  // 2. Typecheck: once for the whole run.
  let typecheckStep: VerificationStep | undefined;
  if (deps.profile.typecheckCommand) {
    if (deps.baselineTypecheck === "red") {
      typecheckStep = {
        kind: "typecheck",
        command: deps.profile.typecheckCommand,
        passed: true,
        skipped: true,
        reason: "baseline typecheck already failing before the fix",
        durationMs: 0,
      };
    } else {
      const result = await deps.sandbox.exec(deps.profile.typecheckCommand, { cwd: deps.sandbox.root, timeoutMs: 180_000, allowFailure: true, signal: deps.signal });
      typecheckStep = {
        kind: "typecheck",
        command: deps.profile.typecheckCommand,
        passed: result.exitCode === 0 && !result.timedOut,
        skipped: false,
        reason: "type-check the repository after the fix",
        durationMs: result.durationMs,
        output: truncate(`${result.stdout}\n${result.stderr}`, 1600),
      };
    }
  }

  // 3. Build: once, only when the change is complex.
  let buildStep: VerificationStep | undefined;
  if (context.size === "complex" && deps.profile.buildCommand) {
    const result = await deps.sandbox.exec(deps.profile.buildCommand, { cwd: deps.sandbox.root, timeoutMs: 300_000, allowFailure: true, signal: deps.signal });
    buildStep = {
      kind: "build",
      command: deps.profile.buildCommand,
      passed: result.exitCode === 0 && !result.timedOut,
      skipped: false,
      reason: "build the project for a complex change",
      durationMs: result.durationMs,
      output: truncate(`${result.stdout}\n${result.stderr}`, 1600),
    };
  }

  // 4. Targeted tests: one run per unique command, shared across repairs.
  const commandCache = new Map<string, CommandOutcome>();
  const runOnce = async (command: string): Promise<CommandOutcome> => {
    const result = await deps.sandbox.exec(command, { cwd: deps.sandbox.root, timeoutMs: 120_000, allowFailure: true, signal: deps.signal });
    return {
      passed: result.exitCode === 0 && !result.timedOut,
      output: truncate(`${result.stdout}\n${result.stderr}`, 1200),
      durationMs: result.durationMs,
    };
  };
  const runCommand = async (command: string): Promise<CommandOutcome> => {
    const cached = commandCache.get(command);
    if (cached) return cached;
    const first = await runOnce(command);
    let outcome = first;
    if (!first.passed) {
      const retry = await runOnce(command);
      outcome = {
        ...retry,
        durationMs: first.durationMs + retry.durationMs,
        reran: true,
        flaky: retry.passed,
      };
    }
    commandCache.set(command, outcome);
    return outcome;
  };

  // 5. Affected tests: the full suite, once, baseline-aware.
  let affectedStep: VerificationStep;
  if (context.size === "tiny") {
    affectedStep = {
      kind: "affected_tests",
      command: deps.profile.testCommand ?? "",
      passed: true,
      skipped: true,
      reason: "change is too small to warrant the full test suite",
      durationMs: 0,
    };
  } else if (!deps.profile.testCommand) {
    affectedStep = {
      kind: "affected_tests",
      command: "",
      passed: true,
      skipped: true,
      reason: "repository has no test command",
      durationMs: 0,
    };
  } else if (!deps.baselineTests) {
    affectedStep = {
      kind: "affected_tests",
      command: deps.profile.testCommand,
      passed: true,
      skipped: true,
      reason: "no baseline test run was captured for this repository",
      durationMs: 0,
    };
  } else if (deps.baselineTests.status === "red") {
    affectedStep = {
      kind: "affected_tests",
      command: deps.profile.testCommand,
      passed: true,
      skipped: true,
      reason: "baseline test suite already failing before the fix",
      durationMs: 0,
    };
  } else if (deps.baselineTests.status !== "green") {
    // Unknown baselines (timeout/unavailable) must not silently disable the
    // strongest regression check; run the suite and judge the result.
    const outcome = await runCommand(deps.profile.testCommand);
    affectedStep = {
      kind: "affected_tests",
      command: deps.profile.testCommand,
      passed: outcome.passed,
      skipped: false,
      reason: `full test suite after the fix (baseline ${deps.baselineTests.status})` + flakeNote(outcome),
      durationMs: outcome.durationMs,
      output: outcome.output,
    };
  } else {
    const outcome = await runCommand(deps.profile.testCommand);
    affectedStep = {
      kind: "affected_tests",
      command: deps.profile.testCommand,
      passed: outcome.passed,
      skipped: false,
      reason: "full test suite after the fix (baseline was green)" + flakeNote(outcome),
      durationMs: outcome.durationMs,
      output: outcome.output,
    };
  }

  let promotedProbeCount = 0;
  for (const entry of eligible) {
    const steps: VerificationStep[] = [];
    const proof = proofById.get(entry.candidate.id)!;
    const reproductionPassed = proof.status === "disproven";
    const artifact = entry.candidate.artifact ?? proof.artifact;
    steps.push({
      kind: "reproduction",
      command:
        artifact?.command ??
        (entry.candidate.check ? `playwright ${entry.candidate.check.label} @ ${entry.candidate.check.path}` : "candidate reproduction"),
      passed: reproductionPassed,
      skipped: false,
      reason:
        proof.status === "disproven"
          ? proof.explanation
          : proof.status === "confirmed"
            ? `defect still reproduces after the fix: ${proof.explanation}`
            : `reproduction inconclusive (${proof.status}): ${proof.explanation}`,
      durationMs: proof.durationMs,
      output: truncate(proof.reproduction, 1200),
    });

    const promotedProbe = entry.repair.probe;
    if (promotedProbe) {
      try {
        await deps.sandbox.write(`${deps.sandbox.root}/.cortado-probes/${promotedProbe.name}`, promotedProbe.content);
        promotedProbeCount += 1;
        const outcome = await runCommand(promotedProbe.command);
        steps.push({
          kind: "authored_probe",
          command: promotedProbe.command,
          passed: outcome.passed,
          skipped: false,
          reason: `model-authored probe that failed before the fix must pass after it${flakeNote(outcome)}`,
          durationMs: outcome.durationMs,
          output: outcome.output,
        });
      } catch (error) {
        steps.push({
          kind: "authored_probe",
          command: promotedProbe.command,
          passed: false,
          skipped: false,
          reason: `promoted probe could not run: ${error instanceof Error ? error.message : String(error)}`,
          durationMs: 0,
        });
      }
    }

    const relatedTests = relatedTestsFor(entry.candidate, context);
    if (relatedTests.length > 0 && deps.profile.testSingle) {
      const command = deps.profile.testSingle(relatedTests[0]);
      const outcome = await runCommand(command);
      steps.push({
        kind: "targeted_tests",
        command,
        passed: outcome.passed,
        skipped: false,
        reason: `tests covering ${entry.candidate.file}${flakeNote(outcome)}`,
        durationMs: outcome.durationMs,
        output: outcome.output,
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

    steps.push({ ...affectedStep });
    if (typecheckStep) steps.push({ ...typecheckStep });
    if (buildStep) steps.push({ ...buildStep });

    const executed = steps.filter((step) => !step.skipped);
    reports[entry.repair.candidateId] = {
      passed: reproductionPassed && executed.length > 0 && executed.every((step) => step.passed),
      steps,
      durationMs: now() - started,
    };
  }

  if (promotedProbeCount > 0) {
    await deps.sandbox
      .exec(`rm -rf ${deps.sandbox.root}/.cortado-probes`, { cwd: deps.sandbox.root, timeoutMs: 15_000, allowFailure: true })
      .catch(() => undefined);
  }

  return reports;
}
