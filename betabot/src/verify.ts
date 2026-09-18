/**
 * Stage 4 — the autmpus loop. Terra designs a sandbox harness, the drafted fix
 * is applied to a fresh clone of the PR head, and the harness runs. On failure
 * terra diagnoses and sol rewrites the edits (in the diff or outside it), up to
 * four attempts. Verified edits replace the stage-3 drafts as suggestions.
 */
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import type { Repository } from "@shared/schema";
import { getInstallationToken } from "../../server/lib/github/app.ts";
import * as githubApi from "../../server/lib/github/api.ts";
import { runCodegenAgent } from "./fixes.ts";
import { parseJson } from "./master.ts";
import { buildCodegraphReport } from "./codegraph.ts";
import { analyseChangedFiles, listRepositoryTree, loadChangedFiles, loadPullRequestContext, loadRepoGraphIndex } from "./run-inputs.ts";
import { publishBetabotComment } from "./github.ts";
import { buildVerifyComment, VERIFY_MARKER } from "./markdown.ts";
import { renderChangedPatches, parsePatches, type ParsedPatch } from "./patch.ts";
import { verifyPlanSystem, verifyPlanUser, verifyRepairSystem, verifyRepairUser } from "./prompts.ts";
import {
  BudgetedModelClient,
  betabotCacheKey,
  codegenModelConfig,
  createBetabotModelClient,
  createBetabotUsageTracker,
  isBetabotBudgetError,
  resolveBetabotModelConfig,
  resolveBetabotSwarmConfig,
  type BetabotModelClient,
  type BetabotModelConfig,
  type BetabotSwarmConfig,
  type BetabotUsageTracker,
} from "./model.ts";
import {
  applyEditsToSandbox,
  clonePullRequest,
  createE2bSandbox,
  detectInstallCommand,
  fallbackVerifyPlan,
  isSafeRelativePath,
  redact,
  resetWorktree,
  runSandboxCommands,
  writeProbeFiles,
  type VerifySandbox,
} from "./sandbox.ts";
import { buildFixReport, replaceBetabotSuggestions, DRAFT_SUGGESTION_BODY } from "./fixes.ts";
import { buildHypothesisReport } from "./hypotheses.ts";
import { sortHypotheses } from "./rules.ts";
import type {
  CodegraphChangedFile,
  CodegraphReport,
  FixEdit,
  FixPlan,
  FixReport,
  GeneratedFix,
  Hypothesis,
  HypothesisReport,
  HypothesisSeverity,
  RepoGraphIndex,
  SandboxCommandRun,
  VerifyAttempt,
  VerifyCommand,
  VerifyEvidence,
  VerifyFixStatus,
  VerifyPlan,
  VerifiedFix,
  VerifyReport,
  VerifyStageResult,
} from "./types.ts";
import { HYPOTHESIS_SEVERITIES } from "./types.ts";
import { BETABOT_VERSION } from "./version.ts";

const MAX_VERIFY_COMMANDS = 5;
const MAX_VERIFY_PROBES = 3;
const MAX_PROBE_CHARS = 30_000;
const MAX_REPAIR_SNAPSHOTS = 4;

const DESTRUCTIVE_COMMAND =
  /\b(rm\s+-rf\s+\/(?!home\/user\/repo)|git\s+push|npm\s+publish|(?:curl|wget)[^\n]*\|\s*(?:ba|z|da)?sh|sudo\b|mkfs\b|dd\s+if=|chmod\s+777\s+\/|shutdown\b|reboot\b)/i;

function emptyRole(id: string) {
  return { id, calls: 0, tokensIn: 0, tokensOut: 0, cachedTokensIn: 0, costUsd: 0, failedCalls: 0 };
}

// ---------------------------------------------------------------------------
// Verification plan parsing
// ---------------------------------------------------------------------------

export interface ParseVerifyPlanOptions {
  commandTimeoutMs: number;
  maxCommands?: number;
  maxProbes?: number;
}

export function parseVerifyPlan(
  text: string,
  options: ParseVerifyPlanOptions,
): { plan: VerifyPlan; dropped: string[] } {
  const parsed = parseJson(text);
  const dropped: string[] = [];
  const maxCommands = options.maxCommands ?? MAX_VERIFY_COMMANDS;
  const maxProbes = options.maxProbes ?? MAX_VERIFY_PROBES;
  const commands: VerifyCommand[] = [];
  const probeFiles: VerifyPlan["probeFiles"] = [];
  const seen = new Set<string>();

  const rawCommands = Array.isArray(parsed?.commands) ? parsed!.commands : [];
  for (const entry of rawCommands) {
    if (commands.length >= maxCommands) {
      dropped.push(`command beyond the ${maxCommands}-command cap`);
      continue;
    }
    if (!entry || typeof entry !== "object") {
      dropped.push("non-object command entry");
      continue;
    }
    const record = entry as Record<string, unknown>;
    const cmd = typeof record.cmd === "string" ? record.cmd.trim() : "";
    if (!cmd || cmd.length > 1_000 || seen.has(cmd)) {
      dropped.push(`invalid command: ${cmd.slice(0, 60) || "(empty)"}`);
      continue;
    }
    if (DESTRUCTIVE_COMMAND.test(cmd)) {
      dropped.push(`refused destructive command: ${cmd.slice(0, 80)}`);
      continue;
    }
    seen.add(cmd);
    const why = typeof record.why === "string" && record.why.trim() ? record.why.trim().slice(0, 300) : "verify the fix";
    const requested = typeof record.timeoutMs === "number" && Number.isFinite(record.timeoutMs) ? Math.floor(record.timeoutMs) : 0;
    const timeoutMs = Math.min(Math.max(requested > 0 ? requested : options.commandTimeoutMs, 5_000), options.commandTimeoutMs);
    commands.push({ cmd, why, timeoutMs });
  }

  const rawProbes = Array.isArray(parsed?.probeFiles) ? parsed!.probeFiles : [];
  for (const entry of rawProbes) {
    if (probeFiles.length >= maxProbes) {
      dropped.push(`probe file beyond the ${maxProbes}-file cap`);
      continue;
    }
    if (!entry || typeof entry !== "object") {
      dropped.push("non-object probe entry");
      continue;
    }
    const record = entry as Record<string, unknown>;
    const path = typeof record.path === "string" ? record.path.trim() : "";
    const content = typeof record.content === "string" ? record.content : "";
    if (!path || !isSafeRelativePath(path)) {
      dropped.push(`unsafe probe path: ${path.slice(0, 80) || "(empty)"}`);
      continue;
    }
    if (content.length === 0 || content.length > MAX_PROBE_CHARS) {
      dropped.push(`probe file content out of bounds: ${path}`);
      continue;
    }
    probeFiles.push({ path, content });
  }

  const probePaths = new Set(probeFiles.map((probe) => probe.path));
  const usableCommands = commands.filter((command) => {
    const references = [...command.cmd.matchAll(/(?:^|[\s'"=(])((?:\.\/)?probe[s]?\/[\w./-]+\.(?:mjs|cjs|js|ts|tsx))/g)].map((match) =>
      match[1].replace(/^\.\//, ""),
    );
    const missing = references.filter((reference) => !probePaths.has(reference));
    if (missing.length === 0) return true;
    dropped.push(`refused command that references ${missing[0]} without including it as a probe file`);
    return false;
  });

  const commandSet = new Set(usableCommands.map((command) => command.cmd));
  const rawMustFail = Array.isArray(parsed?.mustFailBefore) ? parsed!.mustFailBefore : [];
  const mustFailBefore = [...new Set(
    rawMustFail.filter((entry): entry is string => typeof entry === "string" && commandSet.has(entry.trim())).map((entry) => entry.trim()),
  )];

  const install =
    typeof parsed?.install === "string" && parsed.install.trim() ? parsed.install.trim().slice(0, 500) : undefined;
  if (install && DESTRUCTIVE_COMMAND.test(install)) {
    dropped.push(`refused destructive install command: ${install.slice(0, 80)}`);
  }
  const notes = typeof parsed?.notes === "string" && parsed.notes.trim() ? parsed.notes.trim().slice(0, 1_000) : undefined;

  return {
    plan: {
      install: install && !DESTRUCTIVE_COMMAND.test(install) ? install : undefined,
      commands: usableCommands,
      probeFiles,
      mustFailBefore,
      notes,
      source: "terra",
    },
    dropped,
  };
}

// ---------------------------------------------------------------------------
// Fix selection
// ---------------------------------------------------------------------------

export function verifySeverities(config: BetabotSwarmConfig): HypothesisSeverity[] {
  return config.fixSeverities.length > 0 ? config.fixSeverities : [...HYPOTHESIS_SEVERITIES];
}

export function selectVerifyFixes(report: FixReport, severities: HypothesisSeverity[]): GeneratedFix[] {
  const eligible = report.fixes.filter(
    (fix) => fix.outcome === "generated" && fix.edits.length > 0 && severities.includes(fix.hypothesis.severity),
  );
  const order = new Map(sortHypotheses(eligible.map((fix) => fix.hypothesis)).map((hypothesis, index) => [hypothesis.id, index]));
  return [...eligible].sort(
    (a, b) => (order.get(a.hypothesisId) ?? 0) - (order.get(b.hypothesisId) ?? 0),
  );
}

// ---------------------------------------------------------------------------
// Terra calls
// ---------------------------------------------------------------------------

export interface VerifyPlannerInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  hypothesis: Hypothesis;
  plan: FixPlan;
  edits: FixEdit[];
  fileDiffs: string;
  packageJson?: string;
  repositoryTree: string[];
  likelyTests: string[];
  client: BetabotModelClient;
  signal?: AbortSignal;
  cacheKey?: string;
  commandTimeoutMs: number;
}

export async function runVerifyPlanner(
  input: VerifyPlannerInput,
): Promise<{ plan: VerifyPlan; dropped: string[] }> {
  const completion = await input.client.complete({
    system: verifyPlanSystem(MAX_VERIFY_COMMANDS, input.commandTimeoutMs),
    user: verifyPlanUser({
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      title: input.title,
      headSha: input.headSha,
      hypothesis: input.hypothesis,
      plan: input.plan,
      edits: input.edits,
      fileDiffs: input.fileDiffs,
      packageJson: input.packageJson,
      repositoryTree: input.repositoryTree,
      likelyTests: input.likelyTests,
    }),
    signal: input.signal,
    cacheKey: input.cacheKey,
  });
  return parseVerifyPlan(completion.text, { commandTimeoutMs: input.commandTimeoutMs });
}

export type RepairDecision =
  | { action: "repair"; diagnosis: string; plan: FixPlan; edits: FixEdit[]; verifyPlan: VerifyPlan; harnessOnly?: boolean }
  | { action: "unfixable" | "unavailable"; diagnosis: string };

/** Commands, probe paths and reproduction marks — the parts that define a harness. */
export function harnessSignature(plan: VerifyPlan): string {
  return JSON.stringify({
    commands: plan.commands.map((command) => command.cmd),
    probes: plan.probeFiles.map((probe) => probe.path),
    mustFailBefore: plan.mustFailBefore,
  });
}

export function harnessChanged(previous: VerifyPlan, next: VerifyPlan): boolean {
  return harnessSignature(previous) !== harnessSignature(next);
}

export interface VerifyRepairAgentInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  hypothesis: Hypothesis;
  plan: FixPlan;
  edits: FixEdit[];
  attempt: number;
  maxAttempts: number;
  failure: string;
  verifyPlan: VerifyPlan;
  fileSnapshots: Array<{ path: string; content: string }>;
  client: BetabotModelClient;
  signal?: AbortSignal;
  cacheKey?: string;
  commandTimeoutMs: number;
}

function parseRevisedPlan(record: unknown): FixPlan | undefined {
  if (!record || typeof record !== "object") return undefined;
  const raw = record as Record<string, unknown>;
  const summary = typeof raw.summary === "string" ? raw.summary.trim() : "";
  const steps = Array.isArray(raw.steps)
    ? raw.steps.filter((step): step is string => typeof step === "string" && step.trim().length > 0).map((step) => step.trim())
    : [];
  if (!summary || steps.length === 0) return undefined;
  return {
    hypothesisId: "",
    summary,
    steps,
    files: Array.isArray(raw.files)
      ? [...new Set(raw.files.filter((file): file is string => typeof file === "string" && file.trim().length > 0).map((file) => file.trim()))]
      : [],
    risks: typeof raw.risks === "string" && raw.risks.trim() ? raw.risks.trim() : undefined,
    testIdea: typeof raw.testIdea === "string" && raw.testIdea.trim() ? raw.testIdea.trim() : undefined,
  };
}

export async function runVerifyRepair(input: VerifyRepairAgentInput): Promise<RepairDecision> {
  const completion = await input.client.complete({
    system: verifyRepairSystem(),
    user: verifyRepairUser({
      repository: input.repository,
      pullRequestNumber: input.pullRequestNumber,
      title: input.title,
      headSha: input.headSha,
      hypothesis: input.hypothesis,
      plan: input.plan,
      edits: input.edits,
      attempt: input.attempt,
      maxAttempts: input.maxAttempts,
      failure: input.failure,
      commands: input.verifyPlan.commands,
      probeFiles: input.verifyPlan.probeFiles,
      fileSnapshots: input.fileSnapshots,
    }),
    signal: input.signal,
    cacheKey: input.cacheKey,
  });
  const parsed = parseJson(completion.text);
  const diagnosis =
    typeof parsed?.diagnosis === "string" && parsed.diagnosis.trim()
      ? parsed.diagnosis.trim().slice(0, 2_000)
      : "the coordinator did not explain the failure";
  if (parsed?.action === "unfixable") return { action: "unfixable", diagnosis };
  const plan = parseRevisedPlan(parsed?.revisedPlan);
  if (!plan) return { action: "unavailable", diagnosis: `the coordinator did not return a revised plan (${diagnosis})` };
  const rewritten = parseVerifyPlan(JSON.stringify(parsed), { commandTimeoutMs: input.commandTimeoutMs });
  const commands = rewritten.plan.commands.length > 0 ? rewritten.plan.commands : input.verifyPlan.commands;
  const commandSet = new Set(commands.map((command) => command.cmd));
  const probes = new Map(input.verifyPlan.probeFiles.map((probe) => [probe.path, probe]));
  for (const probe of rewritten.plan.probeFiles) probes.set(probe.path, probe);
  const mustFailBefore = (
    rewritten.plan.mustFailBefore.length > 0 ? rewritten.plan.mustFailBefore : input.verifyPlan.mustFailBefore
  ).filter((cmd) => commandSet.has(cmd));
  const verifyPlan: VerifyPlan = {
    commands,
    probeFiles: [...probes.values()],
    mustFailBefore,
    notes: rewritten.plan.notes ?? input.verifyPlan.notes,
    source: "terra",
  };
  return { action: "repair", diagnosis, plan, edits: [], verifyPlan };
}

// ---------------------------------------------------------------------------
// The autmpus loop
// ---------------------------------------------------------------------------

export interface VerifyFixDeps {
  repair(
    fix: GeneratedFix,
    context: {
      edits: FixEdit[];
      plan: FixPlan;
      verifyPlan: VerifyPlan;
      failure: string;
      attempt: number;
      snapshots: Array<{ path: string; content: string }>;
    },
  ): Promise<RepairDecision>;
}

export interface VerifyLoopInput {
  sandbox: VerifySandbox;
  repoDir: string;
  fixes: GeneratedFix[];
  plans: Map<string, VerifyPlan>;
  deps: VerifyFixDeps;
  tracker: BetabotUsageTracker;
  config: BetabotSwarmConfig;
  deadline: number;
  sandboxId: string;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

const TEST_FRAMEWORK = /\b(vitest|jest|mocha|playwright|pytest|ava|tap)\b|@testing-library|node:test/;
const TEST_RUNNER_COMMAND =
  /\b(vitest|jest|mocha|playwright|pytest|ava|tap)\b|--test\b|(^|\s)(npm|pnpm|yarn|bun) (run )?test\b/i;

function testLikeCommand(cmd: string): boolean {
  return TEST_RUNNER_COMMAND.test(cmd);
}

function referencedCommandFiles(cmd: string): string[] {
  return [...cmd.matchAll(/(?:^|[\s'"=])((?:\.\/)?[\w@./-]+\.(?:mjs|cjs|js|ts|tsx))/g)].map((match) =>
    match[1].replace(/^\.\//, ""),
  );
}

/** A probe is behavioral only when it imports or requires repository code. */
export function probeIsBehavioral(content: string): boolean {
  return TEST_FRAMEWORK.test(content) || /import\s*\(|require\s*\(|\bfrom\s+['"](?:[./]|@\/)/.test(content);
}

/** Test runners execute code; probe commands follow the probe that they name. */
export function commandIsBehavioral(cmd: string, plan: VerifyPlan): boolean {
  if (TEST_RUNNER_COMMAND.test(cmd)) return true;
  for (const file of referencedCommandFiles(cmd)) {
    const probe = plan.probeFiles.find((entry) => entry.path === file);
    if (probe) return probeIsBehavioral(probe.content);
  }
  return false;
}

/** Make sure every harness checks imports/callers/bundling with a repo command. */
export function ensureRepoCommand(plan: VerifyPlan, fallback: VerifyPlan): VerifyPlan {
  if (plan.commands.some((command) => TEST_RUNNER_COMMAND.test(command.cmd) || /npm run (check|typecheck|build|test)\b/.test(command.cmd))) {
    return plan;
  }
  const repoCommand = fallback.commands[0];
  if (!repoCommand || plan.commands.some((command) => command.cmd === repoCommand.cmd)) return plan;
  if (plan.commands.length >= MAX_VERIFY_COMMANDS) {
    return { ...plan, commands: [...plan.commands.slice(0, MAX_VERIFY_COMMANDS - 1), repoCommand] };
  }
  return { ...plan, commands: [...plan.commands, repoCommand] };
}

function failureSummary(runs: SandboxCommandRun[], applyErrors: string[]): string {
  if (applyErrors.length > 0) return `the fix did not apply: ${applyErrors[0]}`;
  const failed = runs.find((run) => run.exitCode !== 0 || run.timedOut);
  if (!failed) return "verification failed without a failing command";
  return `\`${failed.cmd}\` exited ${failed.exitCode}${failed.timedOut ? " (timeout)" : ""}: ${
    (failed.stderrTail || failed.stdoutTail || "no output").split("\n").slice(-3).join(" ").slice(0, 300)
  }`;
}

function failureReport(runs: SandboxCommandRun[], applyErrors: string[], preExisting: string[]): string {
  const blocks: string[] = [];
  if (applyErrors.length > 0) blocks.push(`The edits did not apply:\n${applyErrors.map((error) => `- ${error}`).join("\n")}`);
  for (const run of runs) {
    if (run.exitCode === 0 && !run.timedOut) continue;
    const kind = preExisting.includes(run.cmd) ? "pre-existing failure (also fails on the unfixed head)" : "failure";
    blocks.push(
      `Command: ${run.cmd}\nExit: ${run.exitCode}${run.timedOut ? " (timeout)" : ""} (${kind})\n` +
        `stdout tail:\n${run.stdoutTail.slice(-1_500)}\nstderr tail:\n${run.stderrTail.slice(-1_500)}`,
    );
  }
  return blocks.join("\n\n");
}

function passing(run: SandboxCommandRun): boolean {
  return run.exitCode === 0 && !run.timedOut;
}

function evidenceOf(run: VerifyAttempt, plan: VerifyPlan): VerifyEvidence {
  if (run.behavioralReproductions > 0) return "reproduction";
  if (run.reproductions > 0) return "static";
  if (plan.probeFiles.length > 0 && run.runs.some((entry) => entry.behavioral && passing(entry))) return "probe";
  if (run.runs.some((entry) => entry.behavioral && testLikeCommand(entry.cmd) && passing(entry))) return "tests";
  if (run.runs.some((entry) => passing(entry) && COMPILE_COMMAND.test(entry.cmd))) {
    return "compile";
  }
  if (run.runs.some(passing)) return "static";
  return "none";
}

const COMPILE_COMMAND = /\b(tsc|check|typecheck|type-check|build|lint)\b/i;

export async function runVerifyLoop(input: VerifyLoopInput): Promise<VerifiedFix[]> {
  const results: VerifiedFix[] = [];
  const maxAttempts = Math.min(4, Math.max(1, input.config.verifyAttempts));

  for (const fix of input.fixes) {
    const started = Date.now();
    const attempts: VerifyAttempt[] = [];
    const plan = input.plans.get(fix.hypothesisId) ?? {
      commands: [] as VerifyCommand[],
      probeFiles: [],
      mustFailBefore: [],
      source: "fallback" as const,
    };
    const base: Omit<VerifiedFix, "status" | "evidence" | "reason" | "attemptsUsed" | "edits"> = {
      hypothesisId: fix.hypothesisId,
      priority: fix.priority,
      severity: fix.hypothesis.severity,
      hypothesis: fix.hypothesis,
      plan: fix.plan,
      attempts,
      sandboxId: input.sandboxId,
      durationMs: 0,
    };

    if (plan.commands.length === 0) {
      results.push({
        ...base,
        edits: fix.edits,
        status: "inconclusive",
        evidence: "none",
        reason: plan.notes ?? "the verification plan has no commands to run",
        attemptsUsed: 0,
        durationMs: Date.now() - started,
      });
      continue;
    }

    let baseline: VerifiedFix["baseline"];
    let candidate: { edits: FixEdit[]; plan: FixPlan; verifyPlan: VerifyPlan } = {
      edits: fix.edits,
      plan: fix.plan ?? { hypothesisId: fix.hypothesisId, summary: fix.summary, steps: [], files: fix.edits.map((edit) => edit.path) },
      verifyPlan: plan,
    };
    let status: VerifyFixStatus = "unverified";
    let evidence: VerifyEvidence = "none";
    let reason: string | undefined;

    try {
      const baselineStarted = Date.now();
      const resetErrors = await resetWorktree(input.sandbox, input.repoDir);
      if (resetErrors.length > 0) throw new Error(`sandbox reset failed: ${resetErrors[0]}`);
      await writeProbeFiles(input.sandbox, input.repoDir, plan.probeFiles);
      const baselineRuns = await runSandboxCommands({
        sandbox: input.sandbox,
        dir: input.repoDir,
        commands: plan.commands,
        defaultTimeoutMs: input.config.verifyCommandTimeoutMs,
        isBehavioral: (cmd) => commandIsBehavioral(cmd, plan),
        onLog: input.onLog,
      });
      baseline = { runs: baselineRuns, durationMs: Date.now() - baselineStarted };
      const baselineByCmd = new Map(baselineRuns.map((run) => [run.cmd, run]));

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        if (input.signal?.aborted) {
          status = "inconclusive";
          reason = "run aborted";
          break;
        }
        if (input.tracker.exhausted) {
          status = attempts.length > 0 ? "unverified" : "skipped";
          reason = `cost budget exhausted before attempt ${attempt}`;
          break;
        }
        if (Date.now() > input.deadline) {
          status = "inconclusive";
          reason = "stage deadline reached";
          break;
        }
        const attemptStarted = Date.now();
        const reset = await resetWorktree(input.sandbox, input.repoDir);
        await writeProbeFiles(input.sandbox, input.repoDir, candidate.verifyPlan.probeFiles);
        const applied = await applyEditsToSandbox(input.sandbox, input.repoDir, candidate.edits);
        if (reset.length > 0 || applied.errors.length > 0) {
          const applyErrors = [...reset, ...applied.errors];
          const record: VerifyAttempt = {
            attempt,
            kind: attempt === 1 ? "initial" : "repair",
            status: "apply_failed",
            edits: candidate.edits,
            applyErrors,
            runs: [],
            preExisting: [],
            reproductions: 0,
            behavioralReproductions: 0,
            durationMs: Date.now() - attemptStarted,
          };
          attempts.push(record);
          reason = failureSummary([], applyErrors);
          if (attempt >= maxAttempts || input.tracker.exhausted || Date.now() > input.deadline) break;
          const decision = await input.deps.repair(fix, {
            edits: candidate.edits,
            plan: candidate.plan,
            verifyPlan: candidate.verifyPlan,
            failure: failureReport([], applyErrors, []),
            attempt,
            snapshots: [],
          });
          if (decision.action !== "repair") {
            status = decision.action === "unfixable" ? "unverified" : "inconclusive";
            reason = decision.diagnosis;
            break;
          }
          candidate = { edits: decision.edits, plan: decision.plan, verifyPlan: decision.verifyPlan };
          continue;
        }

        const runs = await runSandboxCommands({
          sandbox: input.sandbox,
          dir: input.repoDir,
          commands: candidate.verifyPlan.commands,
          defaultTimeoutMs: input.config.verifyCommandTimeoutMs,
          deadline: input.deadline,
          isBehavioral: (cmd) => commandIsBehavioral(cmd, candidate.verifyPlan),
          onLog: input.onLog,
        });
        const failed = runs.filter((run) => run.exitCode !== 0 || run.timedOut);
        const preExisting = failed
          .filter((run) => {
            const before = baselineByCmd.get(run.cmd);
            return (
              before !== undefined &&
              (before.exitCode !== 0 || before.timedOut) &&
              !candidate.verifyPlan.mustFailBefore.includes(run.cmd)
            );
          })
          .map((run) => run.cmd);
        const reproducedRuns = runs.filter((run) => {
          const before = baselineByCmd.get(run.cmd);
          return before !== undefined && (before.exitCode !== 0 || before.timedOut) && run.exitCode === 0 && !run.timedOut;
        });
        const reproductions = reproducedRuns.length;
        const behavioralReproductions = reproducedRuns.filter((run) => run.behavioral).length;
        const interrupted = runs.length < candidate.verifyPlan.commands.length;
        const passed = failed.length === 0 && !interrupted;
        const allPreExisting = failed.length > 0 && preExisting.length === failed.length;
        const record: VerifyAttempt = {
          attempt,
          kind: attempt === 1 ? "initial" : "repair",
          status: passed ? "passed" : "failed",
          edits: candidate.edits,
          applyErrors: [],
          runs,
          preExisting,
          reproductions,
          behavioralReproductions,
          durationMs: Date.now() - attemptStarted,
        };

        if (passed) {
          attempts.push(record);
          status = "verified";
          evidence = evidenceOf(record, candidate.verifyPlan);
          reason = undefined;
          break;
        }

        reason = interrupted ? "the stage deadline interrupted verification" : failureSummary(failed, []);
        if (attempt >= maxAttempts) {
          attempts.push(record);
          status = allPreExisting ? "inconclusive" : "unverified";
          break;
        }

        const snapshots: Array<{ path: string; content: string }> = [];
        for (const path of [...new Set(candidate.edits.map((edit) => edit.path))].slice(0, MAX_REPAIR_SNAPSHOTS)) {
          try {
            snapshots.push({ path, content: (await input.sandbox.read(`${input.repoDir}/${path}`)).slice(0, 8_000) });
          } catch {
            continue;
          }
        }
        await resetWorktree(input.sandbox, input.repoDir);
        const decision = await input.deps.repair(fix, {
          edits: candidate.edits,
          plan: candidate.plan,
          verifyPlan: candidate.verifyPlan,
          failure: failureReport(runs, [], preExisting),
          attempt,
          snapshots,
        });
        if (decision.action !== "repair") {
          attempts.push({
            ...record,
            diagnosis: decision.diagnosis,
            status: decision.action === "unfixable" ? "failed" : "repair_unavailable",
          });
          status =
            decision.action !== "unfixable" || allPreExisting
              ? "inconclusive"
              : "unverified";
          reason = decision.diagnosis;
          break;
        }
        attempts.push({ ...record, diagnosis: decision.diagnosis, status: "failed" });
        candidate = { edits: decision.edits, plan: decision.plan, verifyPlan: decision.verifyPlan };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status = "inconclusive";
      reason = redact(message).slice(0, 500);
    }

    results.push({
      ...base,
      edits: candidate.edits,
      probeFiles: candidate.verifyPlan.probeFiles,
      status,
      evidence,
      reason,
      attemptsUsed: attempts.length,
      attempts,
      baseline,
      durationMs: Date.now() - started,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Stage orchestration
// ---------------------------------------------------------------------------

export interface BuildVerifyReportInput {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  title: string;
  fixReport: FixReport;
  files: CodegraphChangedFile[];
  patches: Map<string, ParsedPatch>;
  analyses: Map<string, FileAnalysis>;
  report: CodegraphReport;
  index: RepoGraphIndex | null;
  installationId?: string | number;
  fullName?: string;
  severities?: HypothesisSeverity[];
  verifySandbox?: VerifySandbox | null;
  coordinatorClient?: BetabotModelClient | null;
  codegenClient?: BetabotModelClient | null;
  modelConfig?: BetabotModelConfig;
  swarmConfig?: BetabotSwarmConfig;
  usageTracker?: BetabotUsageTracker;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

interface Prepared {
  plans: Map<string, VerifyPlan>;
  warnings: string[];
}

function inconclusiveFix(fix: GeneratedFix, reason: string, sandboxId: string): VerifiedFix {
  return {
    hypothesisId: fix.hypothesisId,
    priority: fix.priority,
    severity: fix.hypothesis.severity,
    hypothesis: fix.hypothesis,
    plan: fix.plan,
    edits: fix.edits,
    status: "inconclusive",
    evidence: "none",
    reason,
    attemptsUsed: 0,
    attempts: [],
    sandboxId,
    durationMs: 0,
  };
}

function skippedFix(fix: GeneratedFix, reason: string): VerifiedFix {
  return {
    hypothesisId: fix.hypothesisId,
    priority: fix.priority,
    severity: fix.hypothesis.severity,
    hypothesis: fix.hypothesis,
    plan: fix.plan,
    edits: fix.edits,
    status: "skipped",
    evidence: "none",
    reason,
    attemptsUsed: 0,
    attempts: [],
    sandboxId: "",
    durationMs: 0,
  };
}

function totalsOf(fixes: VerifiedFix[], available: number): VerifyReport["totals"] {
  const count = (status: VerifyFixStatus) => fixes.filter((fix) => fix.status === status).length;
  return {
    available,
    eligible: fixes.length,
    verified: count("verified"),
    unverified: count("unverified"),
    skipped: count("skipped"),
    inconclusive: count("inconclusive"),
    reproductions: fixes.filter((fix) => fix.evidence === "reproduction").length,
    behavioral: fixes.filter((fix) => fix.evidence === "reproduction" || fix.evidence === "probe" || fix.evidence === "tests").length,
    attempts: fixes.reduce((total, fix) => total + fix.attempts.length, 0),
    commands: fixes.reduce((total, fix) => total + fix.attempts.reduce((sum, attempt) => sum + attempt.runs.length, 0), 0),
  };
}

export async function buildVerifyReport(input: BuildVerifyReportInput): Promise<VerifyReport> {
  const configured = input.modelConfig ?? resolveBetabotModelConfig();
  const swarmConfig = input.swarmConfig ?? resolveBetabotSwarmConfig();
  const severities = input.severities ?? verifySeverities(swarmConfig);
  const warnings: string[] = [];
  const selected = selectVerifyFixes(input.fixReport, severities);
  const available = input.fixReport.fixes.filter((fix) => fix.outcome === "generated" && fix.edits.length > 0).length;

  const usageOf = (used: boolean, reason?: string) => ({
    coordinator: used ? { ...emptyRole(configured.model), id: configured.model } : emptyRole(configured.model),
    swarm: emptyRole(configured.swarmModel),
    codegen: emptyRole(configured.codegenModel),
    totalCostUsd: 0,
    maxCostUsd: swarmConfig.maxCostUsd,
    used,
    reason,
  });

  const reportBase = (fixes: VerifiedFix[], sandbox: VerifyReport["sandbox"]): VerifyReport => ({
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    fixes,
    totals: totalsOf(fixes, available),
    sandbox,
    usage: usageOf(false, "verification did not run"),
    suggestions: { posted: 0, skipped: 0, removed: 0 },
    warnings,
  });

  if (selected.length === 0) {
    return reportBase([], { id: null, template: swarmConfig.e2bTemplate, created: false });
  }
  if (input.verifySandbox === null || !swarmConfig.verifyEnabled) {
    return reportBase(
      selected.map((fix) => skippedFix(fix, "sandbox verification is disabled for this run")),
      { id: null, template: swarmConfig.e2bTemplate, created: false },
    );
  }

  const tracker = input.usageTracker ?? createBetabotUsageTracker(swarmConfig);
  tracker.beginReservedStage("verify");
  const coordinator = new BudgetedModelClient(
    input.coordinatorClient ?? createBetabotModelClient(configured),
    tracker,
    "coordinator",
    { modelId: configured.model, maxOutputTokens: configured.maxTokens },
  );
  const codegen = new BudgetedModelClient(
    input.codegenClient ?? createBetabotModelClient(codegenModelConfig(configured)),
    tracker,
    "codegen",
    { modelId: configured.codegenModel, maxOutputTokens: configured.codegenMaxTokens ?? configured.maxTokens },
  );

  let treePaths: string[] = [];
  let packageJson: string | undefined;
  if (input.installationId !== undefined) {
    const fullName = input.fullName ?? input.repository;
    try {
      const tree = await listRepositoryTree({
        installationId: input.installationId,
        fullName,
        headSha: input.headSha,
      });
      treePaths = tree.paths;
      if (tree.truncated) warnings.push("the repository tree was truncated by GitHub; verification planning sees a partial tree");
    } catch (error) {
      warnings.push(`repository tree unavailable (${error instanceof Error ? error.message : String(error)})`);
    }
    if (treePaths.includes("package.json")) {
      packageJson =
        (await githubApi.getFileContent(input.installationId, fullName, "package.json", input.headSha).catch(() => null)) ??
        undefined;
    }
  }

  const planFor = async (fix: GeneratedFix): Promise<VerifyPlan> => {
    if (swarmConfig.verifyCommands.length > 0) {
      return fallbackVerifyPlan({
        paths: treePaths,
        packageJson,
        overrideCommands: swarmConfig.verifyCommands,
        commandTimeoutMs: swarmConfig.verifyCommandTimeoutMs,
      });
    }
    const repoChecks = fallbackVerifyPlan({
      paths: treePaths,
      packageJson,
      commandTimeoutMs: swarmConfig.verifyCommandTimeoutMs,
    });
    try {
      const planned = await runVerifyPlanner({
        repository: input.repository,
        pullRequestNumber: input.pullRequestNumber,
        title: input.title,
        headSha: input.headSha,
        hypothesis: fix.hypothesis,
        plan: fix.plan ?? { hypothesisId: fix.hypothesisId, summary: fix.summary, steps: [], files: fix.edits.map((edit) => edit.path) },
        edits: fix.edits,
        fileDiffs: renderChangedPatches(input.files.filter((file) => (fix.plan?.files ?? [fix.hypothesis.file]).includes(file.path)), 8_000),
        packageJson,
        repositoryTree: treePaths,
        likelyTests: input.report.files.find((file) => file.path === fix.hypothesis.file)?.tests ?? [],
        client: coordinator,
        signal: input.signal,
        cacheKey: betabotCacheKey("coordinator", input),
        commandTimeoutMs: swarmConfig.verifyCommandTimeoutMs,
      });
      if (planned.dropped.length > 0) warnings.push(`verify plan for ${fix.hypothesisId}: ${planned.dropped.join("; ")}`);
      if (planned.plan.commands.length > 0 || planned.plan.probeFiles.length > 0) {
        const merged = ensureRepoCommand(planned.plan, repoChecks);
        if (merged !== planned.plan) {
          warnings.push(`verify plan for ${fix.hypothesisId} missed a repository check; added ${repoChecks.commands[0].cmd}`);
        }
        return merged;
      }
      if (repoChecks.commands.length > 0) {
        warnings.push(`verify plan for ${fix.hypothesisId} was empty; fell back to the repository's own scripts`);
        return repoChecks;
      }
      return planned.plan;
    } catch (error) {
      if (isBetabotBudgetError(error)) throw error;
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`verify planning failed for ${fix.hypothesisId} (${redact(message).slice(0, 200)}); fell back to the repository's scripts`);
      return fallbackVerifyPlan({ paths: treePaths, packageJson, commandTimeoutMs: swarmConfig.verifyCommandTimeoutMs });
    }
  };

  const plans = new Map<string, VerifyPlan>();
  for (const fix of selected) {
    if (tracker.exhausted) {
      plans.set(fix.hypothesisId, {
        commands: [],
        probeFiles: [],
        mustFailBefore: [],
        source: "fallback",
        notes: `cost budget exhausted ($${tracker.remainingUsd.toFixed(4)} left)`,
      });
      continue;
    }
    try {
      plans.set(fix.hypothesisId, await planFor(fix));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      plans.set(fix.hypothesisId, {
        commands: [],
        probeFiles: [],
        mustFailBefore: [],
        source: "fallback",
        notes: `verify planning failed: ${message}`,
      });
    }
  }

  const hasCommands = [...plans.values()].some((plan) => plan.commands.length > 0);
  if (!hasCommands) {
    return reportBase(
      selected.map((fix) => inconclusiveFix(fix, plans.get(fix.hypothesisId)?.notes ?? "no verification command was planned", "")),
      { id: null, template: swarmConfig.e2bTemplate, created: false },
    );
  }

  let sandbox = input.verifySandbox;
  let created = false;
  if (!sandbox) {
    const apiKey = process.env.E2B_API_KEY?.trim();
    if (!apiKey) {
      warnings.push("E2B_API_KEY is not configured; sandbox verification did not run");
      return reportBase(
        selected.map((fix) => skippedFix(fix, "E2B_API_KEY is not configured")),
        { id: null, template: swarmConfig.e2bTemplate, created: false },
      );
    }
    try {
      sandbox = await createE2bSandbox({
        template: swarmConfig.e2bTemplate,
        timeoutMs: swarmConfig.e2bTimeoutMs,
        apiKey,
        metadata: {
          betabot: "verify",
          repository: input.repository,
          pullRequest: String(input.pullRequestNumber),
        },
      });
      created = true;
    } catch (error) {
      const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 300);
      warnings.push(`sandbox creation failed (${message})`);
      return reportBase(
        selected.map((fix) => inconclusiveFix(fix, `sandbox creation failed: ${message}`, "")),
        { id: null, template: swarmConfig.e2bTemplate, created: false, error: message },
      );
    }
  }

  let report: VerifyReport;
  try {
    const cloneStarted = Date.now();
    const token =
      input.installationId !== undefined
        ? await getInstallationToken(input.installationId).catch(() => process.env.GITHUB_TOKEN?.trim() ?? process.env.GH_TOKEN?.trim() ?? "")
        : process.env.GITHUB_TOKEN?.trim() ?? process.env.GH_TOKEN?.trim() ?? "";
    if (!token) throw new Error("no GitHub installation token is available for cloning");
    const cloned = await clonePullRequest(sandbox, {
      fullName: input.fullName ?? input.repository,
      pullRequestNumber: input.pullRequestNumber,
      headSha: input.headSha,
      token,
    });

    const installPlan = detectInstallCommand(treePaths, undefined);
    let install: SandboxCommandRun | undefined;
    if (installPlan.cmd) {
      const installRuns = await runSandboxCommands({
        sandbox,
        dir: cloned.dir,
        commands: [{ cmd: installPlan.cmd, why: `install dependencies (${installPlan.reason})`, timeoutMs: swarmConfig.verifyCommandTimeoutMs }],
        defaultTimeoutMs: swarmConfig.verifyCommandTimeoutMs,
        onLog: input.onLog,
      });
      install = installRuns[0];
      if (!install || install.exitCode !== 0) {
        const message = `dependency install failed (${installPlan.cmd} exited ${install?.exitCode ?? "?"})`;
        warnings.push(message);
        report = {
          ...reportBase(
            selected.map((fix) => inconclusiveFix(fix, message, sandbox!.id)),
            { id: sandbox.id, template: swarmConfig.e2bTemplate, created, cloneMs: cloned.durationMs, installMs: install?.durationMs },
          ),
          usage: {
            coordinator: { ...tracker.usage.coordinator },
            swarm: { ...tracker.usage.swarm },
            codegen: { ...tracker.usage.codegen },
            totalCostUsd: tracker.totalCostUsd,
            maxCostUsd: tracker.maxCostUsd,
            used: tracker.totalCalls > 0,
            reason: tracker.totalCalls > 0 ? undefined : "no model call completed",
          },
        };
        return report;
      }
    }

    const deadline = Date.now() + swarmConfig.verifyTimeoutMs;
    const deps: VerifyFixDeps = {
      repair: async (fix, context) => {
        try {
          const decision = await runVerifyRepair({
            repository: input.repository,
            pullRequestNumber: input.pullRequestNumber,
            title: input.title,
            headSha: input.headSha,
            hypothesis: fix.hypothesis,
            plan: context.plan,
            edits: context.edits,
            attempt: context.attempt,
            maxAttempts: Math.min(4, Math.max(1, swarmConfig.verifyAttempts)),
            failure: context.failure,
            verifyPlan: context.verifyPlan,
            fileSnapshots: context.snapshots,
            client: coordinator,
            signal: input.signal,
            cacheKey: betabotCacheKey("coordinator", input),
            commandTimeoutMs: swarmConfig.verifyCommandTimeoutMs,
          });
          if (decision.action !== "repair") return decision;
          const rewritten = await runCodegenAgent({
            repository: input.repository,
            pullRequestNumber: input.pullRequestNumber,
            title: input.title,
            headSha: input.headSha,
            installationId: input.installationId,
            fullName: input.fullName,
            hypothesis: fix.hypothesis,
            plan: { ...decision.plan, hypothesisId: fix.hypothesisId },
            files: input.files,
            patches: input.patches,
            analyses: input.analyses,
            report: input.report,
            index: input.index,
            client: codegen,
            config: swarmConfig,
            deadline: Date.now() + swarmConfig.verifyTimeoutMs,
            failureContext: `${decision.diagnosis}\n\n${context.failure}`,
            signal: input.signal,
            onLog: input.onLog,
            readFile: async (path) => {
              try {
                await resetWorktree(sandbox!, cloned.dir);
                return await sandbox!.read(`${cloned.dir}/${path}`);
              } catch {
                return undefined;
              }
            },
          });
          if (rewritten.edits.length === 0) {
            if (harnessChanged(context.verifyPlan, decision.verifyPlan)) {
              return {
                ...decision,
                harnessOnly: true,
                edits: context.edits,
                diagnosis: `${decision.diagnosis} — harness updated, the source edits were kept${
                  rewritten.errors.length > 0 ? ` (${rewritten.errors.join("; ")})` : ""
                }`,
              };
            }
            return {
              action: "unavailable",
              diagnosis: `${decision.diagnosis} — the engineer returned no usable edits and the harness did not change${
                rewritten.errors.length > 0 ? ` (${rewritten.errors.join("; ")})` : ""
              }`,
            };
          }
          return { ...decision, edits: rewritten.edits };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { action: "unavailable", diagnosis: redact(message).slice(0, 500) };
        }
      },
    };

    const verified = await runVerifyLoop({
      sandbox,
      repoDir: cloned.dir,
      fixes: selected,
      plans,
      deps,
      tracker,
      config: swarmConfig,
      deadline,
      sandboxId: sandbox.id,
      onLog: input.onLog,
      signal: input.signal,
    });
    for (const fix of verified) {
      if (install) fix.install = install;
      if (fix.status === "verified" && (fix.evidence === "static" || fix.evidence === "compile")) {
        warnings.push(
          `fix ${fix.hypothesisId} is verified with ${fix.evidence === "static" ? "source-text" : "compile"} checks only; ` +
            "runtime behavior and knock-on effects were not exercised",
        );
      }
    }
    report = {
      ...reportBase(verified, {
        id: sandbox.id,
        template: swarmConfig.e2bTemplate,
        created,
        cloneMs: cloned.durationMs,
        installMs: install?.durationMs,
      }),
      usage: {
        coordinator: { ...tracker.usage.coordinator },
        swarm: { ...tracker.usage.swarm },
        codegen: { ...tracker.usage.codegen },
        totalCostUsd: tracker.totalCostUsd,
        maxCostUsd: tracker.maxCostUsd,
        used: tracker.totalCalls > 0,
        reason: tracker.totalCalls > 0 ? undefined : "no model call completed",
      },
    };
  } catch (error) {
    const message = redact(error instanceof Error ? error.message : String(error)).slice(0, 500);
    warnings.push(`sandbox verification failed (${message})`);
    report = {
      ...reportBase(
        selected.map((fix) => inconclusiveFix(fix, message, sandbox!.id)),
        { id: sandbox.id, template: swarmConfig.e2bTemplate, created, error: message },
      ),
      usage: {
        coordinator: { ...tracker.usage.coordinator },
        swarm: { ...tracker.usage.swarm },
        codegen: { ...tracker.usage.codegen },
        totalCostUsd: tracker.totalCostUsd,
        maxCostUsd: tracker.maxCostUsd,
        used: tracker.totalCalls > 0,
        reason: tracker.totalCalls > 0 ? undefined : "no model call completed",
      },
    };
  } finally {
    if (created && sandbox) await sandbox.close();
  }

  return report;
}

// ---------------------------------------------------------------------------
// Stage
// ---------------------------------------------------------------------------

export interface PlannedReviewSuggestions {
  fixes: GeneratedFix[];
  label: string;
  body: string;
  /** True when the set is the sandbox-verified one. */
  verified: boolean;
}

function verifiedAsGeneratedFix(fix: VerifiedFix): GeneratedFix {
  return {
    hypothesisId: fix.hypothesisId,
    priority: fix.priority,
    hypothesis: fix.hypothesis,
    plan: fix.plan,
    edits: fix.edits,
    summary: `verified in sandbox (${fix.evidence}) with ${fix.attemptsUsed} attempt(s)`,
    confidence: fix.evidence === "reproduction" ? 0.95 : fix.evidence === "none" ? 0.5 : 0.8,
    attempts: fix.attemptsUsed,
    outcome: "generated",
  };
}

/**
 * The suggestion set that follows the review comment: the verified fixes when
 * verification ran, otherwise the drafts. An empty `fixes` list is meaningful:
 * verification ran and nothing passed, so the previous suggestions are removed.
 */
export function plannedSuggestions(input: {
  verifyReport?: VerifyReport;
  fixReport?: FixReport;
}): PlannedReviewSuggestions | undefined {
  const attempted = input.verifyReport?.fixes.some((fix) => fix.attempts.length > 0) ?? false;
  if (attempted && input.verifyReport) {
    return {
      verified: true,
      label: "Betabot verified fix",
      body:
        "**Betabot verified fixes** — these suggestions passed sandbox verification " +
        "(attempts, commands and evidence are in the review comment).",
      fixes: input.verifyReport.fixes.filter((fix) => fix.status === "verified").map(verifiedAsGeneratedFix),
    };
  }
  const drafts = (input.fixReport?.fixes ?? []).filter((fix) => fix.outcome === "generated");
  if (drafts.length === 0) return undefined;
  return {
    verified: false,
    label: "Betabot draft fix — not sandbox-verified",
    body: DRAFT_SUGGESTION_BODY,
    fixes: drafts,
  };
}

export interface VerifyStageInput {
  runId: string;
  repository: Repository;
  pullRequestNumber: number;
  dryRun?: boolean;
  /** false defers publishing to the pipeline's single review comment. */
  publish?: boolean;
  /** true keeps suggestions off GitHub so the review comment is posted first. */
  deferSuggestions?: boolean;
  maxFiles?: number;
  maxFixes?: number;
  severities?: HypothesisSeverity[];
  /** Structured handoffs from earlier stages; rebuilt internally when absent. */
  hypothesisReport?: HypothesisReport;
  fixReport?: FixReport;
  modelClient?: BetabotModelClient | null;
  swarmClient?: BetabotModelClient | null;
  codegenClient?: BetabotModelClient | null;
  modelConfig?: BetabotModelConfig;
  swarmConfig?: BetabotSwarmConfig;
  usageTracker?: BetabotUsageTracker;
  /** Injectable sandbox; `null` disables verification for this run. */
  verifySandbox?: VerifySandbox | null;
  readFile?: (path: string) => Promise<string | undefined>;
  searchCode?: (query: string) => Promise<Array<{ path: string; fragments: string[] }>>;
  onLog?: (message: string) => void;
  signal?: AbortSignal;
}

export async function runVerifyStage(input: VerifyStageInput): Promise<VerifyStageResult> {
  const started = Date.now();
  const repository = input.repository;
  const context = await loadPullRequestContext(repository, input.pullRequestNumber);
  const files = await loadChangedFiles({
    installationId: context.installationId,
    fullName: context.fullName,
    pullRequestNumber: input.pullRequestNumber,
    maxFiles: input.maxFiles,
  });
  const analyses = await analyseChangedFiles({
    installationId: context.installationId,
    fullName: context.fullName,
    headSha: context.headSha,
    files,
  });
  const index = await loadRepoGraphIndex(repository.id).catch(() => null);
  const codegraph = buildCodegraphReport({
    repository: repository.fullName,
    pullRequestNumber: input.pullRequestNumber,
    headSha: context.headSha,
    files,
    analyses,
    index,
    maxFiles: input.maxFiles,
  });

  const noModel = process.env.BETABOT_NO_MODEL === "1";
  const swarmConfig = input.swarmConfig ?? resolveBetabotSwarmConfig();
  const tracker = input.usageTracker ?? createBetabotUsageTracker(swarmConfig);
  const hypothesisReport =
    input.hypothesisReport ??
    (input.fixReport
      ? undefined
      : await buildHypothesisReport({
          repository: repository.fullName,
          pullRequestNumber: input.pullRequestNumber,
          headSha: context.headSha,
          title: context.title,
          body: context.body,
          files,
          analyses,
          index,
          maxFiles: input.maxFiles,
          modelClient: input.modelClient === undefined ? (noModel ? null : undefined) : input.modelClient,
          swarmClient: input.swarmClient === undefined ? (noModel ? null : undefined) : input.swarmClient,
          modelConfig: input.modelConfig,
          swarmConfig: input.swarmConfig,
          installationId: context.installationId,
          fullName: context.fullName,
          usageTracker: tracker,
          onLog: input.onLog,
          signal: input.signal,
        }));

  const fixReport =
    input.fixReport ??
    (await buildFixReport({
      repository: repository.fullName,
      pullRequestNumber: input.pullRequestNumber,
      headSha: context.headSha,
      title: context.title,
      hypotheses: hypothesisReport?.hypotheses ?? [],
      files,
      patches: parsePatches(files),
      analyses,
      report: codegraph,
      index,
      installationId: context.installationId,
      fullName: context.fullName,
      maxFixes: input.maxFixes,
      severities: input.severities,
      coordinatorClient: input.modelClient === undefined ? (noModel ? null : undefined) : input.modelClient,
      codegenClient: input.codegenClient === undefined ? (noModel ? null : undefined) : input.codegenClient,
      modelConfig: input.modelConfig,
      swarmConfig,
      readFile: input.readFile,
      searchCode: input.searchCode,
      usageTracker: tracker,
      onLog: input.onLog,
      signal: input.signal,
    }));

  const verifyReport = await buildVerifyReport({
    repository: repository.fullName,
    pullRequestNumber: input.pullRequestNumber,
    headSha: context.headSha,
    title: context.title,
    fixReport,
    files,
    patches: parsePatches(files),
    analyses,
    report: codegraph,
    index,
    installationId: context.installationId,
    fullName: context.fullName,
    severities: input.severities,
    verifySandbox: input.verifySandbox,
    coordinatorClient: input.modelClient === undefined ? (noModel ? null : undefined) : input.modelClient,
    codegenClient: input.codegenClient === undefined ? (noModel ? null : undefined) : input.codegenClient,
    modelConfig: input.modelConfig,
    swarmConfig,
    usageTracker: tracker,
    onLog: input.onLog,
    signal: input.signal,
  });

  let commentId: number | null = null;
  let commentUrl: string | null = null;
  let replacedComments = 0;
  const suggestionPlan = plannedSuggestions({ verifyReport, fixReport });
  if (suggestionPlan && !suggestionPlan.verified) {
    verifyReport.warnings.push("sandbox verification did not run; the drafts are posted unverified");
  }
  let body = buildVerifyComment({ report: verifyReport, runId: input.runId, version: BETABOT_VERSION });
  // The review comment is published first so it leads the PR conversation; the
  // suggestion review follows it.
  if (!input.dryRun && input.publish !== false) {
    const published = await publishBetabotComment({
      installationId: context.installationId,
      fullName: context.fullName,
      pullRequestNumber: input.pullRequestNumber,
      marker: VERIFY_MARKER,
      body,
    });
    commentId = published.id;
    commentUrl = published.url;
    replacedComments = published.replaced;
  }
  if (!input.dryRun && !input.deferSuggestions && suggestionPlan) {
    try {
      const replaced = await replaceBetabotSuggestions({
        installationId: context.installationId,
        fullName: context.fullName,
        pullRequestNumber: input.pullRequestNumber,
        headSha: context.headSha,
        fixes: suggestionPlan.fixes,
        body: suggestionPlan.body,
        label: suggestionPlan.label,
      });
      verifyReport.suggestions = { posted: replaced.posted, skipped: replaced.skipped, removed: replaced.removed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      verifyReport.suggestions = { posted: 0, skipped: 0, removed: 0, error: message };
      verifyReport.warnings.push(`inline suggestions unavailable (${message}); the patches remain in the comment`);
      body = buildVerifyComment({ report: verifyReport, runId: input.runId, version: BETABOT_VERSION });
      if (!input.dryRun && input.publish !== false && commentId !== null) {
        const republished = await publishBetabotComment({
          installationId: context.installationId,
          fullName: context.fullName,
          pullRequestNumber: input.pullRequestNumber,
          marker: VERIFY_MARKER,
          body,
        });
        commentId = republished.id;
        commentUrl = republished.url;
        replacedComments += republished.replaced;
      }
    }
  }
  const summary =
    `${verifyReport.totals.verified}/${verifyReport.totals.eligible} verified · ` +
    `${verifyReport.totals.attempts} attempt(s) · $${verifyReport.usage.totalCostUsd.toFixed(4)}`;
  return {
    stage: "verify",
    version: BETABOT_VERSION,
    durationMs: Date.now() - started,
    headSha: context.headSha,
    summary,
    body,
    commentId,
    commentUrl,
    replacedComments,
    report: verifyReport,
    hypothesisReport,
    fixReport,
  };
}
