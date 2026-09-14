import type { PrFixture } from "../../fixtures/prs";
import { parseChangedFiles } from "../../src/stages/change-intelligence";
import { detectForFiles, detectorPresentInContent, type DetectorFinding } from "../../src/agents/detectors";
import { MemorySandbox } from "../../src/sandbox";
import { commandResult, type ExecOptions, type ExecResult } from "../../src/sandbox/types";
import type { SimulatedClock } from "../../src/util/clock";
import type { RepairBehavior } from "../../src/models/dry";

export type ProofBehavior = "confirm" | "no-repro" | "flaky" | "timeout" | "missing-deps";

export interface Scenario {
  fixture: PrFixture;
  proof: ProofBehavior;
  repair: RepairBehavior;
}

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

export class ScenarioSandbox extends MemorySandbox {
  patchesApplied = 0;
  proofPhase = true;
  readonly patchedFiles = new Set<string>();
  private flakyRuns = 0;
  private readonly findings: DetectorFinding[];
  private readonly scenario: Scenario;

  constructor(scenario: Scenario, files: Record<string, string>, private readonly clock: SimulatedClock) {
    super({ id: `scenario-${scenario.fixture.id}-${scenario.proof}-${scenario.repair}`, files });
    this.scenario = scenario;
    const changedFiles = parseChangedFiles(scenario.fixture.pullRequest.files);
    this.findings = detectForFiles(changedFiles, [...ALL_AGENT_KINDS], 200);
  }

  override async applyPatch(patch: string): Promise<import("../../src/util/diff").PatchApplyResult> {
    const result = await super.applyPatch(patch);
    if (result.ok) {
      this.patchesApplied++;
      this.proofPhase = false;
      for (const file of result.files) {
        if (file.applied) this.patchedFiles.add(file.path);
      }
    }
    return result;
  }

  override async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    this.toolCalls++;
    this.commands.push(command);
    if (this.isProbe(command)) return this.probeResult(command);
    if (this.isTest(command)) return this.testResult(command);
    if (this.isLongCommand(command)) return commandResult(command, { exitCode: 0, stdout: "ok" });
    return commandResult(command, { exitCode: 0, stdout: "ok" });
  }

  private isProbe(command: string): boolean {
    return command.startsWith("cortado-probe");
  }

  private isTest(command: string): boolean {
    return /npm\s+(test|run)|vitest|jest|pytest|node --test/.test(command);
  }

  private isLongCommand(command: string): boolean {
    return /tsc|typecheck|build/.test(command);
  }

  bugPresent(scope: Set<string> | null = null): boolean {
    for (const finding of this.findings) {
      if (scope && !scope.has(finding.file)) continue;
      const content = this.files[finding.file];
      if (content === undefined) continue;
      if (detectorPresentInContent(finding.ruleId, content, finding)) return true;
    }
    return false;
  }

  scopeForCommand(command: string): Set<string> {
    const files = new Set(this.findings.map((finding) => finding.file));
    const testTokens = command
      .split(/\s+/)
      .filter((token) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(token));
    if (testTokens.length > 0) {
      const targets = new Set<string>();
      for (const token of testTokens) {
        const base = (token.split("/").pop() ?? token).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "");
        for (const file of files) {
          if (file === token) continue;
          if (/(\.(test|spec)\.|__tests__|\/tests?\/)/.test(file)) continue;
          const fileBase = (file.split("/").pop() ?? file).replace(/\.[cm]?[jt]sx?$/, "");
          if (fileBase === base || fileBase.startsWith(base) || base.startsWith(fileBase)) {
            targets.add(file);
          }
        }
      }
      if (targets.size > 0) return targets;
      for (const token of testTokens) {
        if (files.has(token)) return new Set([token]);
      }
      return new Set(testTokens);
    }
    return new Set(this.patchedFiles);
  }

  private probeResult(command: string): ExecResult {
    if (this.proofPhase) {
      switch (this.scenario.proof) {
        case "no-repro":
          return commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE\n" });
        case "flaky":
          this.flakyRuns++;
          return this.flakyRuns === 1
            ? commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE\n" })
            : commandResult(command, { exitCode: 1, stdout: "CORTADO_VULNERABLE\n" });
        case "timeout":
          return commandResult(command, { exitCode: 124, timedOut: true, stderr: "probe timed out" });
        case "missing-deps":
          return commandResult(command, { exitCode: 127, stderr: "sh: command not found" });
        default:
          return this.bugPresent()
            ? commandResult(command, { exitCode: 1, stdout: "CORTADO_VULNERABLE\n" })
            : commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE\n" });
      }
    }
    if (this.scenario.repair === "timeout") {
      this.clock.advance(30_000);
      return commandResult(command, { exitCode: 124, timedOut: true, stderr: "probe timed out" });
    }
    return this.bugPresent(this.scopeForCommand(command))
      ? commandResult(command, { exitCode: 1, stdout: "CORTADO_VULNERABLE\n" })
      : commandResult(command, { exitCode: 0, stdout: "CORTADO_SAFE\n" });
  }

  private testResult(command: string): ExecResult {
    if (this.proofPhase) {
      switch (this.scenario.proof) {
        case "no-repro":
          return commandResult(command, { exitCode: 0, stdout: "Tests: 1 passed\n" });
        case "flaky": {
          this.flakyRuns++;
          if (this.flakyRuns === 1) return commandResult(command, { exitCode: 0, stdout: "Tests: 1 passed\n" });
          return this.bugPresent()
            ? commandResult(command, { exitCode: 1, stderr: "AssertionError: expected false to be true\n" })
            : commandResult(command, { exitCode: 0, stdout: "Tests: 1 passed\n" });
        }
        case "timeout":
          return commandResult(command, { exitCode: 124, timedOut: true, stderr: "test runner timed out" });
        case "missing-deps":
          return commandResult(command, { exitCode: 127, stderr: "sh: vitest: command not found" });
        default:
          return this.bugPresent()
            ? commandResult(command, { exitCode: 1, stderr: "AssertionError: reproduction failed\n" })
            : commandResult(command, { exitCode: 0, stdout: "Tests: 1 passed\n" });
      }
    }
    if (this.scenario.repair === "timeout") {
      this.clock.advance(30_000);
      return commandResult(command, { exitCode: 124, timedOut: true, stderr: "test runner timed out" });
    }
    return this.bugPresent(this.scopeForCommand(command))
      ? commandResult(command, { exitCode: 1, stderr: "AssertionError: reproduction failed\n" })
      : commandResult(command, { exitCode: 0, stdout: "Tests: 1 passed\n" });
  }
}

export function scenarioKey(scenario: Scenario): string {
  return `${scenario.fixture.id}__proof-${scenario.proof}__repair-${scenario.repair}`;
}
