import type { BrowserCheckResult, Candidate, PRContext, ProofAttempt, ProofResult } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import { truncate, type Logger } from "./util";

export interface ProofDeps {
  sandbox: Sandbox;
  profile: RepoProfile;
  logger: Logger;
  context?: PRContext;
  now?: () => number;
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

function isHarnessFailure(result: BrowserCheckResult | undefined): boolean {
  if (!result) return true;
  return Boolean(result.harnessError) || /failed to run|harness error/i.test(result.detail);
}

/** Source file -> test file that covers it, using the host test list. */
export function relatedTestFile(candidate: Candidate, profile: RepoProfile, context?: PRContext): string | undefined {
  if (!candidate.file || !context || !profile.testSingle) return undefined;
  const base = candidate.file.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
  if (base.length < 3) return undefined;
  const match = context.tests.find((test) => test.toLowerCase().includes(base.toLowerCase()));
  return match;
}

function testCommandFor(candidate: Candidate, profile: RepoProfile, context?: PRContext): string | undefined {
  const related = relatedTestFile(candidate, profile, context);
  if (related) return profile.testSingle!(related);
  if (candidate.suggestedProof === "existing_test" && profile.testCommand) return profile.testCommand;
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
  const passed = first.filter((result) => result.passed && !isHarnessFailure(result)).map((result) => result.id);
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

export async function proveCandidates(
  toProve: Candidate[],
  context: PRContext,
  deps: ProofDeps,
): Promise<{ results: ProofResult[]; appLog: string }> {
  const now = deps.now ?? (() => Date.now());
  const results: ProofResult[] = [];
  const browserCandidates = toProve.filter((candidate) => candidate.check);
  const testCandidates = toProve.filter((candidate) => !candidate.check && (candidate.suggestedProof === "existing_test" || candidate.suggestedProof === "targeted_test"));
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
        if (isHarnessFailure(result)) {
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
    const command = testCommandFor(candidate, deps.profile, deps.context ?? context);
    if (!command) {
      results.push(emptyResult(candidate, "error", `no repository test covers ${candidate.file ?? "this candidate"}`, started, now));
      continue;
    }
    const exec = await deps.sandbox.exec(command, { cwd: deps.sandbox.root, timeoutMs: 120_000, allowFailure: true });
    const output = `${exec.stdout}\n${exec.stderr}`;
    const targetName = (candidate.file ?? "").split("/").pop()?.split(".")[0] ?? "";
    const mentionsTarget = targetName.length > 0 && output.toLowerCase().includes(targetName.toLowerCase());
    const failed = exec.exitCode !== 0 && !exec.timedOut;
    const confirmed = failed && mentionsTarget;
    const attempt: ProofAttempt = {
      strategy: "targeted_test",
      command,
      exitCode: exec.exitCode,
      timedOut: exec.timedOut,
      output: truncate(output, 2400),
      matched: confirmed,
      durationMs: exec.durationMs,
    };
    results.push({
      candidateId: candidate.id,
      status: confirmed
        ? "confirmed"
        : exec.timedOut || /not found|no test files|missing script|no repository test/i.test(output)
          ? "error"
          : failed
            ? "likely"
            : "disproven",
      strategy: "targeted_test",
      attempts: [attempt],
      reproduction: `${command}\n${truncate(output, 700)}`,
      explanation: confirmed
        ? `Repository test fails and references ${candidate.file}`
        : failed
          ? "Repository test fails without referencing the candidate file; treated as inconclusive"
          : "Repository test passes on the PR head; claim not reproduced",
      durationMs: exec.durationMs,
    });
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
    const exec = await deps.sandbox.exec(command, { cwd: deps.sandbox.root, timeoutMs: 120_000, allowFailure: true });
    if (exec.timedOut || /not found|no test files|missing script|no repository test/i.test(`${exec.stdout}\n${exec.stderr}`)) {
      return emptyResult(candidate, "error", `targeted test could not run: ${truncate(exec.stderr || exec.stdout, 300)}`, started, now);
    }
    const failed = exec.exitCode !== 0;
    return {
      candidateId: candidate.id,
      status: failed ? "likely" : "disproven",
      strategy: "targeted_test",
      attempts: [
        {
          strategy: "targeted_test",
          command,
          exitCode: exec.exitCode,
          timedOut: exec.timedOut,
          output: truncate(`${exec.stdout}\n${exec.stderr}`, 2000),
          matched: failed,
          durationMs: exec.durationMs,
        },
      ],
      reproduction: `${command}\n${truncate(exec.stdout + exec.stderr, 600)}`,
      explanation: failed ? "targeted test still failing" : "targeted test passes",
      durationMs: now() - started,
    };
  }

  let app: { url: string; stop: () => Promise<void> } | undefined;
  try {
    app = await deps.sandbox.startApp({ port: 4173, readyPath: candidate.check.path });
    const results = await runBrowserBatchWithConfirmation([{ id: candidate.id, check: candidate.check }], deps, app.url);
    const result = results.get(candidate.id);
    if (isHarnessFailure(result)) {
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
