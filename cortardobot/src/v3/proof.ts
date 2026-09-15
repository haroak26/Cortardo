import type { BrowserCheckResult, Candidate, PRContext, ProofAttempt, ProofResult } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import { truncate, type Logger } from "./util";

export interface ProofDeps {
  sandbox: Sandbox;
  profile: RepoProfile;
  logger: Logger;
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
      const checks = browserCandidates.map((candidate) => ({ id: candidate.id, check: candidate.check! }));
      const started = now();
      const checkResults = await deps.sandbox.browserChecks(checks, app.url);
      const duration = now() - started;
      const byId = new Map<string, BrowserCheckResult>(checkResults.map((result) => [result.id, result]));
      for (const candidate of browserCandidates) {
        const result = byId.get(candidate.id);
        if (!result || /failed to run/.test(result.detail)) {
          results.push(
            emptyResult(candidate, "error", `browser check could not run: ${result?.detail ?? "no result"}`, startedAll, now),
          );
          continue;
        }
        const confirmed = !result.passed;
        const attempt: ProofAttempt = {
          strategy: "browser",
          command: `playwright ${candidate.check!.label} @ ${candidate.check!.path}${candidate.check!.clickText ? ` (click "${candidate.check!.clickText}")` : ""}`,
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
        results.push({
          candidateId: candidate.id,
          status: confirmed ? "confirmed" : "disproven",
          strategy: "browser",
          attempts: [attempt],
          reproduction: truncate(
            `${candidate.check!.label} at ${candidate.check!.path}\n${result.detail}${result.pageErrors.length > 0 ? `\n${result.pageErrors[0]}` : ""}`,
            900,
          ),
          explanation: confirmed
            ? `Reproduced in a real browser: ${result.detail}`
            : `Browser check passed on the PR head; the claim did not reproduce: ${result.detail}`,
          durationMs: result.durationMs,
        });
      }
      appLog = checkResults
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
    const testFile = candidate.file && deps.profile.testSingle ? candidate.file : undefined;
    const command = testFile ? deps.profile.testSingle!(testFile) : deps.profile.testCommand!;
    const exec = await deps.sandbox.exec(command, { cwd: deps.sandbox.root, timeoutMs: 120_000, allowFailure: true });
    const output = `${exec.stdout}\n${exec.stderr}`;
    const basename = (candidate.file ?? "").split("/").pop() ?? "";
    const mentionsTarget = basename.length > 0 && output.toLowerCase().includes(basename.toLowerCase().split(".")[0]);
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
      status: confirmed ? "confirmed" : exec.timedOut || /not found|no test files|missing script/i.test(output) ? "error" : failed ? "likely" : "disproven",
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
    if (candidate.suggestedProof === "targeted_test" && deps.profile.testCommand) {
      const command = candidate.file && deps.profile.testSingle ? deps.profile.testSingle(candidate.file) : deps.profile.testCommand;
      const exec = await deps.sandbox.exec(command, { cwd: deps.sandbox.root, timeoutMs: 120_000, allowFailure: true });
      const failed = exec.exitCode !== 0 && !exec.timedOut;
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
    return emptyResult(candidate, "error", "no executable proof available", started, now);
  }

  let app: { url: string; stop: () => Promise<void> } | undefined;
  try {
    app = await deps.sandbox.startApp({ port: 4173, readyPath: candidate.check.path });
    const [result] = await deps.sandbox.browserChecks([{ id: candidate.id, check: candidate.check }], app.url);
    if (!result || /failed to run/.test(result.detail)) {
      return emptyResult(candidate, "error", `browser check could not run: ${result?.detail ?? "no result"}`, started, now);
    }
    const confirmed = !result.passed;
    return {
      candidateId: candidate.id,
      status: confirmed ? "confirmed" : "disproven",
      strategy: "browser",
      attempts: [
        {
          strategy: "browser",
          command: `playwright ${candidate.check.label} @ ${candidate.check.path}`,
          exitCode: confirmed ? 1 : 0,
          timedOut: false,
          output: truncate(
            [result.detail, ...result.pageErrors.map((error) => `[pageerror] ${error}`), ...result.consoleErrors.slice(0, 2)].join("\n"),
            2000,
          ),
          matched: confirmed,
          durationMs: result.durationMs,
          checks: [result],
        },
      ],
      reproduction: `${candidate.check.label} at ${candidate.check.path}\n${result.detail}${result.pageErrors[0] ? `\n${result.pageErrors[0]}` : ""}`,
      explanation: confirmed ? `Reproduction still fails: ${result.detail}` : `Reproduction passes: ${result.detail}`,
      durationMs: result.durationMs,
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
