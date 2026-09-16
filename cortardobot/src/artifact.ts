/**
 * Reproduction artifact runner.
 *
 * An artifact is a script plus an optional setup/teardown pair, always executed
 * with a pinned runtime — never the repository test framework. Runtime
 * scenarios use setup to start the app and teardown to stop it, so the exact
 * same artifact can be replayed during confirmation, repair and verification.
 */
import type { ExecResult, ReproArtifact, Sandbox } from "./types";

export const HARNESS_ERROR_RE =
  /Cannot find module|MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND|command not found|ENOENT|no such file|SyntaxError|Unexpected token|is not recognized|Unknown file extension|EADDRINUSE|ECONNREFUSED/i;

const BROWSER_ENV = "PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright NODE_PATH=$(npm root -g)";

function usesPlaywright(content: string | undefined): boolean {
  return Boolean(content && /require\(\s*["']playwright["']\s*\)|from\s+["']playwright["']|@playwright\/test/.test(content));
}

/** Pinned runtime for a probe file — never the repository test framework. */
export function probeCommand(path: string, content?: string): string {
  const extension = path.slice(path.lastIndexOf("."));
  if (extension === ".py") return `python3 ${path}`;
  if (extension === ".sh") return `bash ${path}`;
  if (extension === ".ts" || extension === ".mts") return `npx --no-install tsx ${path} || node --import tsx ${path}`;
  const base = `node ${path}`;
  return usesPlaywright(content) ? `${BROWSER_ENV} ${base}` : base;
}

async function execSetup(sandbox: Sandbox, commands: string[], signal?: AbortSignal): Promise<{ ok: true } | { ok: false; output: string }> {
  for (const command of commands) {
    const result = await sandbox.exec(command, { cwd: sandbox.root, timeoutMs: 180_000, allowFailure: true, signal });
    if (result.exitCode !== 0 || result.timedOut) {
      return { ok: false, output: `${command}\n${`${result.stdout}\n${result.stderr}`.trim()}` };
    }
  }
  return { ok: true };
}

async function execTeardown(sandbox: Sandbox, commands: string[]): Promise<void> {
  for (const command of commands) {
    await sandbox.exec(command, { cwd: sandbox.root, timeoutMs: 60_000, allowFailure: true }).catch(() => undefined);
  }
}

export interface ArtifactRunResult {
  /** True when every run matched the expectation. */
  passed: boolean;
  /** True when the artifact could not run at all (setup, timeout, crash). */
  harnessError: boolean;
  outputs: string[];
  failures: number;
  reason: string;
}

/**
 * Runs the artifact: setup once, the script `runs` times, teardown always.
 * `expect: "fail"` is the reproduction contract (the defect is present);
 * `expect: "pass"` is the fix contract (the defect is gone).
 */
export async function runArtifact(
  sandbox: Sandbox,
  artifact: ReproArtifact,
  probeDir: string,
  options: { runs: number; expect: "pass" | "fail"; signal?: AbortSignal; target?: string },
): Promise<ArtifactRunResult> {
  await sandbox.write(`${probeDir}/${artifact.path}`, artifact.content);
  if (artifact.setup && artifact.setup.length > 0) {
    const setup = await execSetup(sandbox, artifact.setup, options.signal);
    if (!setup.ok) {
      await execTeardown(sandbox, artifact.teardown ?? []);
      return { passed: false, harnessError: true, outputs: [setup.output], failures: 0, reason: `setup failed: ${setup.output.slice(0, 300)}` };
    }
  }

  const outputs: string[] = [];
  let failures = 0;
  let harnessError = false;
  try {
    for (let run = 1; run <= Math.max(1, options.runs); run += 1) {
      const result: ExecResult = await sandbox.exec(artifact.command, {
        cwd: sandbox.root,
        timeoutMs: 120_000,
        allowFailure: true,
        signal: options.signal,
      });
      const output = `${result.stdout}\n${result.stderr}`.trim();
      outputs.push(output);
      if (result.timedOut) {
        harnessError = true;
        break;
      }
      if (result.exitCode !== 0) {
        failures += 1;
        const mentionsTarget = Boolean(options.target && output.toLowerCase().includes(options.target.toLowerCase()));
        if (HARNESS_ERROR_RE.test(output) && !mentionsTarget) harnessError = true;
      }
    }
  } finally {
    await execTeardown(sandbox, artifact.teardown ?? []);
  }

  const allFailed = failures === Math.max(1, options.runs);
  const passed = options.expect === "fail" ? allFailed && !harnessError : failures === 0 && !harnessError;
  const reason = passed
    ? options.expect === "fail"
      ? `the reproduction failed ${failures} time(s) on the head`
      : `the reproduction passed ${options.runs} time(s) on the clean replay`
    : harnessError
      ? `the artifact could not run: ${(outputs[outputs.length - 1] ?? "").slice(0, 300)}`
      : options.expect === "fail"
        ? `the artifact passed on the head (run ${failures + 1})`
        : `the artifact still fails on the clean replay`;
  return { passed, harnessError, outputs, failures, reason };
}
