import type { BrowserCheckResult, Candidate, PRContext, ProofArtifact, ProofAttempt, ProofResult } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import { truncate, type Logger } from "./util";
import { relatedTestsFor } from "./test-index";

export interface ProofDeps {
  sandbox: Sandbox;
  profile: RepoProfile;
  logger: Logger;
  context?: PRContext;
  now?: () => number;
  /** Cancellation signal from the owning stage (3.3). */
  signal?: AbortSignal;
}

function emptyResult(candidate: Candidate, status: ProofResult["status"], explanation: string, started: number, now: () => number): ProofResult {
  return {
    candidateId: candidate.id,
    status,
    strategy: "none",
    attempts: [],
    reproduction: explanation,
    explanation,
    durationMs: now() - started,
  };
}

function isHarnessFailure(result: BrowserCheckResult | undefined, check?: Candidate["check"]): boolean {
  if (!result) return true;
  if (result.harnessError) return true;
  // A redirect means the assertion never evaluated the page it targeted; a
  // failure there is not evidence of the claimed defect (3.4 E2E fix).
  if (check && !check.clickText && check.assert.type !== "pathEquals" && result.landedPath && result.landedPath !== check.path) return true;
  return /failed to run|harness error/i.test(result.detail);
}

/** Source file -> test file that covers it, using the repo-wide test index. */
export function relatedTestFile(candidate: Candidate, profile: RepoProfile, context?: PRContext): string | undefined {
  if (!candidate.file || !context || !profile.testSingle) return undefined;
  const match = relatedTestsFor(candidate, context)[0];
  return match;
}

/** Command that replays the candidate's proof artifact, if any. */
export function artifactCommand(candidate: Candidate): string | undefined {
  const artifact = candidate.artifact;
  if (artifact?.command) return artifact.command;
  return undefined;
}

function testCommandFor(candidate: Candidate, profile: RepoProfile, context?: PRContext): string | undefined {
  const artifact = artifactCommand(candidate);
  if (artifact) return artifact;
  const related = relatedTestFile(candidate, profile, context);
  if (related) return profile.testSingle!(related);
  if ((candidate.suggestedProof === "existing_test" || candidate.suggestedProof === "targeted_test") && profile.testCommand) return profile.testCommand;
  return undefined;
}

/**
 * Runs a browser batch and re-runs any check that passed. A single pass must
 * never be the only evidence that a defect is gone; the confirmation run is
 * authoritative and a harness error is reported as error, never as a pass.
 */
async function runBrowserBatchWithConfirmation(
  entries: Array<{ id: string; check: NonNullable<Candidate["check"]> }>,
  deps: ProofDeps,
  appUrl: string,
): Promise<Map<string, BrowserCheckResult>> {
  const first = await deps.sandbox.browserChecks(entries, appUrl);
  const byId = new Map(first.map((result) => [result.id, result]));
  const checksById = new Map(entries.map((entry) => [entry.id, entry.check]));
  const passed = first.filter((result) => result.passed && !isHarnessFailure(result, checksById.get(result.id))).map((result) => result.id);
  if (passed.length > 0) {
    const again = await deps.sandbox.browserChecks(
      entries.filter((entry) => passed.includes(entry.id)),
      appUrl,
    );
    for (const result of again) byId.set(result.id, result);
  }
  return byId;
}

function browserAttempt(candidate: Candidate, result: BrowserCheckResult, confirmed: boolean): ProofAttempt {
  return {
    strategy: "browser",
    command: `playwright ${candidate.check?.label ?? "check"} @ ${candidate.check?.path ?? "/"}${candidate.check?.clickText ? ` (click "${candidate.check.clickText}")` : ""}`,
    exitCode: confirmed ? 1 : 0,
    timedOut: false,
    output: truncate(
      [result.detail, ...result.pageErrors.map((error) => `[pageerror] ${error}`), ...result.consoleErrors.slice(0, 3).map((error) => `[console] ${error}`)].join("\n"),
      2400,
    ),
    matched: confirmed,
    durationMs: result.durationMs,
    checks: [result],
  };
}

function targetMentioned(candidate: Candidate, output: string): boolean {
  const targetName = (candidate.file ?? "").split("/").pop()?.split(".")[0] ?? "";
  return targetName.length > 0 && output.toLowerCase().includes(targetName.toLowerCase());
}

async function execArtifact(
  candidate: Candidate,
  command: string,
  deps: ProofDeps,
): Promise<{ result: Awaited<ReturnType<Sandbox["exec"]>>; output: string }> {
  const result = await deps.sandbox.exec(command, { cwd: deps.sandbox.root, timeoutMs: 120_000, allowFailure: true, signal: deps.signal });
  return { result, output: `${result.stdout}\n${result.stderr}` };
}

/**
 * Replays an artifact. Probe artifacts must fail twice (flake guard) before a
 * defect may be confirmed; existing/targeted tests run once in the proof stage
 * and twice in verification.
 */
export async function proveArtifact(
  candidate: Candidate,
  command: string,
  strategy: ProofArtifact["kind"] | "targeted_test",
  deps: ProofDeps,
  now: () => number,
  attemptsRequired: number,
): Promise<ProofResult> {
  const started = now();
  const attempts: ProofAttempt[] = [];
  let failures = 0;
  let firstFailureOutput = "";
  for (let run = 0; run < attemptsRequired; run++) {
    const { result, output } = await execArtifact(candidate, command, deps);
    if (result.timedOut) {
      return emptyResult(candidate, "error", `proof artifact timed out: ${truncate(output, 300)}`, started, now);
    }
    if (/not found|no test files|missing script|no such file|Cannot find module|MODULE_NOT_FOUND|ENOENT/i.test(output)) {
      return emptyResult(candidate, "error", `proof artifact could not run: ${truncate(output, 300)}`, started, now);
    }
    const failed = result.exitCode !== 0;
    if (failed) {
      failures += 1;
      if (!firstFailureOutput) firstFailureOutput = output;
    }
    attempts.push({
      strategy: strategy === "browser_check" ? "browser" : strategy,
      command,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      output: truncate(output, 2400),
      matched: failed,
      durationMs: result.durationMs,
    });
    if (!failed) break;
  }

  const artifact: ProofArtifact | undefined = candidate.artifact
    ? { ...candidate.artifact, preFixFailures: failures }
    : undefined;

  if (failures >= attemptsRequired) {
    return {
      candidateId: candidate.id,
      status: "confirmed",
      strategy: strategy === "browser_check" ? "browser" : strategy,
      attempts,
      reproduction: `${command}\n${truncate(firstFailureOutput, 700)}`,
      explanation: `Reproduced by the candidate's proof artifact (${failures} consecutive failure(s) on the PR head)`,
      durationMs: now() - started,
      artifact,
    };
  }
  if (failures > 0) {
    return {
      candidateId: candidate.id,
      status: "likely",
      strategy: strategy === "browser_check" ? "browser" : strategy,
      attempts,
      reproduction: `${command}\n${truncate(firstFailureOutput, 700)}`,
      explanation: `Proof artifact failed once but did not confirm on the second run (flake guard)`,
      durationMs: now() - started,
      artifact,
    };
  }
  return {
    candidateId: candidate.id,
    status: "disproven",
    strategy: strategy === "browser_check" ? "browser" : strategy,
    attempts,
    reproduction: `${command}\nartifact passed on the PR head`,
    explanation: "Proof artifact passes on the PR head; the claim did not reproduce",
    durationMs: now() - started,
    artifact,
  };
}

export async function proveCandidates(
  toProve: Candidate[],
  context: PRContext,
  deps: ProofDeps,
): Promise<{ results: ProofResult[]; appLog: string }> {
  const now = deps.now ?? (() => Date.now());
  const results: ProofResult[] = [];
  const browserCandidates = toProve.filter((candidate) => candidate.check);
  const testCandidates = toProve.filter((candidate) => !candidate.check && Boolean(testCommandFor(candidate, deps.profile, deps.context ?? context)));
  const rest = toProve.filter((candidate) => !browserCandidates.includes(candidate) && !testCandidates.includes(candidate));
  let appLog = "";

  if (browserCandidates.length > 0) {
    const startedAll = now();
    let app: { url: string; stop: () => Promise<void> } | undefined;
    try {
      deps.logger.info(`proof: starting app for ${browserCandidates.length} browser check(s)`);
      app = await deps.sandbox.startApp({ port: 4173, readyPath: browserCandidates[0].check?.path });
      const started = now();
      const checkResults = await runBrowserBatchWithConfirmation(
        browserCandidates.map((candidate) => ({ id: candidate.id, check: candidate.check! })),
        deps,
        app.url,
      );
      const duration = now() - started;
      for (const candidate of browserCandidates) {
        const result = checkResults.get(candidate.id);
        if (isHarnessFailure(result, candidate.check)) {
          results.push(emptyResult(candidate, "error", `browser check could not run: ${result?.detail ?? "no result"}`, startedAll, now));
          continue;
        }
        const confirmed = !result!.passed;
        results.push({
          candidateId: candidate.id,
          status: confirmed ? "confirmed" : "disproven",
          strategy: "browser",
          attempts: [browserAttempt(candidate, result!, confirmed)],
          reproduction: truncate(
            `${candidate.check!.label} at ${candidate.check!.path}\n${result!.detail}${result!.pageErrors.length > 0 ? `\n${result!.pageErrors[0]}` : ""}`,
            900,
          ),
          explanation: confirmed
            ? `Reproduced in a real browser: ${result!.detail}`
            : `Browser check passed twice on the PR head; the claim did not reproduce: ${result!.detail}`,
          durationMs: result!.durationMs,
          artifact: { kind: "browser_check", check: candidate.check, preFixFailures: confirmed ? 2 : 0, artifactHash: "" },
        });
      }
      appLog = [...checkResults.values()]
        .map((result) => `${result.path}: ${result.detail}${result.pageErrors.length > 0 ? ` | ${result.pageErrors[0].split("\n")[0]}` : ""}`)
        .join("\n");
      deps.logger.info(`proof: browser batch finished in ${duration}ms`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      appLog = `app boot failed: ${message}`;
      for (const candidate of browserCandidates) {
        results.push(emptyResult(candidate, "error", `app could not be booted for browser proof: ${message}`, startedAll, now));
      }
    } finally {
      if (app) await app.stop().catch(() => undefined);
    }
  }

  for (const candidate of testCandidates) {
    const started = now();
    const command = testCommandFor(candidate, deps.profile, deps.context ?? context)!;
    const strategy = candidate.artifact?.kind ?? "targeted_test";
    const attemptsRequired = candidate.artifact?.kind === "probe" ? 2 : 1;
    const proof = await proveArtifact(candidate, command, strategy, deps, now, attemptsRequired);
    if (proof.status === "confirmed") {
      const mention = targetMentioned(candidate, proof.reproduction);
      if (!mention) {
        results.push({
          ...proof,
          status: "likely",
          explanation: `Proof artifact fails but the output does not reference ${candidate.file ?? "the candidate"}; treated as inconclusive`,
        });
        deps.logger.info(`proof: artifact for ${candidate.id} failed without referencing the candidate; inconclusive`);
        continue;
      }
    }
    results.push(proof);
    deps.logger.info(`proof: artifact for ${candidate.id} -> ${proof.status} in ${now() - started}ms`);
  }

  for (const candidate of rest) {
    results.push(emptyResult(candidate, "error", "no executable proof was available for this candidate", now(), now));
  }

  return { results, appLog };
}

export async function proveOne(candidate: Candidate, deps: ProofDeps): Promise<ProofResult> {
  const now = deps.now ?? (() => Date.now());
  const started = now();
  if (!candidate.check) {
    const command = testCommandFor(candidate, deps.profile, deps.context);
    if (!command) return emptyResult(candidate, "error", "no executable proof available", started, now);
    const attemptsRequired = candidate.artifact?.kind === "probe" ? 2 : 1;
    return proveArtifact(candidate, command, candidate.artifact?.kind ?? "targeted_test", deps, now, attemptsRequired);
  }

  let app: { url: string; stop: () => Promise<void> } | undefined;
  try {
    app = await deps.sandbox.startApp({ port: 4173, readyPath: candidate.check.path });
    const results = await runBrowserBatchWithConfirmation([{ id: candidate.id, check: candidate.check }], deps, app.url);
    const result = results.get(candidate.id);
    if (isHarnessFailure(result, candidate.check)) {
      return emptyResult(candidate, "error", `browser check could not run: ${result?.detail ?? "no result"}`, started, now);
    }
    const confirmed = !result!.passed;
    return {
      candidateId: candidate.id,
      status: confirmed ? "confirmed" : "disproven",
      strategy: "browser",
      attempts: [browserAttempt(candidate, result!, confirmed)],
      reproduction: `${candidate.check.label} at ${candidate.check.path}\n${result!.detail}${result!.pageErrors[0] ? `\n${result!.pageErrors[0]}` : ""}`,
      explanation: confirmed
        ? `Reproduction still fails: ${result!.detail}`
        : `Reproduction passes twice on a fresh boot: ${result!.detail}`,
      durationMs: result!.durationMs,
      artifact: { kind: "browser_check", check: candidate.check, preFixFailures: confirmed ? 2 : 0, artifactHash: "" },
    };
  } catch (error) {
    return emptyResult(candidate, "error", `app boot failed: ${error instanceof Error ? error.message : String(error)}`, started, now);
  } finally {
    if (app) await app.stop().catch(() => undefined);
  }
}

export function proofStatusForCheck(candidate: Candidate): "browser" | "targeted_test" | "none" {
  if (candidate.check) return "browser";
  if (candidate.suggestedProof === "targeted_test" || candidate.suggestedProof === "existing_test") return "targeted_test";
  return "none";
}
