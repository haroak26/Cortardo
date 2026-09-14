import type { ChangedFile } from "../types";
import { detectForFiles, detectorPresentInContent, type DetectorFinding } from "../agents/detectors";
import { isTestPath } from "../stages/change-intelligence";
import type { ExecHandler } from "./memory";
import { commandResult } from "./types";

const ALL_AGENT_KINDS = [
  "bug",
  "auth",
  "security",
  "regression",
  "runtime",
  "performance",
  "database",
  "api",
  "ui",
  "config",
] as const;

const TEST_COMMAND_RE = /npm\s+(test|run)|vitest|jest|pytest|node --test|mocha/;

export interface DrySimulationOptions {
  /** Force every experiment to pass, simulating a PR where nothing reproduces. */
  neverReproduce?: boolean;
  /** Force every experiment to fail, simulating a broken environment. */
  alwaysFail?: boolean;
}

/**
 * Deterministic command handler used by dry mode when no sandbox handler is supplied.
 * It simulates a repository whose test suite fails while known defects are present and
 * passes once the deterministic repair fixes them. No process is ever spawned.
 */
export function createDrySimulationHandler(
  changedFiles: ChangedFile[],
  options: DrySimulationOptions = {},
): ExecHandler {
  const findings: DetectorFinding[] = detectForFiles(changedFiles, [...ALL_AGENT_KINDS], 200);
  let initial: Record<string, string> | undefined;
  const touched = new Set<string>();

  const bugPresent = (files: Record<string, string>, scope: Set<string> | null): boolean => {
    for (const finding of findings) {
      if (scope && !scope.has(finding.file)) continue;
      const content = files[finding.file];
      if (content === undefined) continue;
      if (detectorPresentInContent(finding.ruleId, content, finding)) return true;
    }
    return false;
  };

  const scopeFor = (command: string): Set<string> => {
    const files = new Set(findings.map((finding) => finding.file));
    const tests = command.split(/\s+/).filter((token) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(token));
    if (tests.length > 0) {
      const targets = new Set<string>();
      for (const token of tests) {
        const base = (token.split("/").pop() ?? token).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "");
        for (const file of files) {
          if (file === token || isTestPath(file)) continue;
          const fileBase = (file.split("/").pop() ?? file).replace(/\.[cm]?[jt]sx?$/, "");
          if (fileBase === base || fileBase.startsWith(base) || base.startsWith(fileBase)) targets.add(file);
        }
      }
      if (targets.size > 0) return targets;
      return new Set(tests);
    }
    return touched.size > 0 ? new Set(touched) : files;
  };

  return (command, files) => {
    if (!initial) initial = { ...files };
    for (const [path, content] of Object.entries(files)) {
      if (initial[path] !== content) touched.add(path);
    }

    if (options.alwaysFail) {
      return commandResult(command, { exitCode: 127, stderr: "sh: command not found" });
    }
    if (options.neverReproduce) {
      if (command.startsWith("cortado-probe")) {
        return commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE\n" });
      }
      return commandResult(command, { exitCode: 0, stdout: "Tests: 1 passed\n" });
    }

    const buggy = bugPresent(files, scopeFor(command));
    if (command.startsWith("cortado-probe")) {
      return buggy
        ? commandResult(command, { exitCode: 1, stdout: "CORTADO_VULNERABLE\n" })
        : commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE\n" });
    }
    if (/tsc|typecheck|run build|vite build|webpack/.test(command)) {
      return commandResult(command, { exitCode: 0, stdout: "ok\n" });
    }
    if (TEST_COMMAND_RE.test(command)) {
      return buggy
        ? commandResult(command, { exitCode: 1, stderr: "AssertionError: reproduction failed\n" })
        : commandResult(command, { exitCode: 0, stdout: "Tests: 1 passed\n" });
    }
    return commandResult(command, { exitCode: 0, stdout: "ok\n" });
  };
}
