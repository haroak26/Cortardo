/**
 * Fix stage: three attempts per reproduced finding, each smarter than the
 * last. A failed attempt gets a diagnosis and a context-refresh swarm before
 * the next try. Edits are rolled back between attempts; the probe artifact is
 * always restored from its recorded content so the engineer cannot move the
 * goalposts.
 */
import { runAgent, type AgentRunResult } from "../agent/loop";
import { diagnosisSystem, diagnosisUser, engineerInitial, engineerSystem, researcherInitial, researcherSystem } from "../agent/prompts";
import { ENGINEER_TOOLS, RESEARCHER_TOOLS, type ToolContext } from "../agent/tools";
import type { PRContext } from "../context/pack";
import { renderFindingContext, renderSwarmContext } from "../context/pack";
import type { ModelRouter } from "../models";
import { unifiedDiffFromEdits } from "../patch";
import type { CandidateRecord, Finding, FixAttempt, RepairEdit, Sandbox } from "../types";
import { truncate, type Logger } from "../util";
import { runArtifact } from "../artifact";
import { assessEdits } from "../safety";

export interface FixDeps {
  sandbox: Sandbox;
  transport: ModelRouter;
  context: PRContext;
  logger: Logger;
  attempts: number;
  maxTurns: number;
  maxToolsPerTurn: number;
  diagnosisQuestions: number;
  refreshResearchers: number;
  refreshTurns: number;
  deadline: number;
  signal?: AbortSignal;
  /** Absolute epoch ms after which the run stops starting new fixes. */
  globalDeadline: number;
  runAgentImpl?: typeof runAgent;
  /** True when the transport has no budget left for new work. */
  budgetExhausted?: () => boolean;
}

export interface FixResult {
  findings: Finding[];
  candidates: CandidateRecord[];
}

async function restore(sandbox: Sandbox, snapshots: Map<string, string>): Promise<void> {
  for (const [path, content] of snapshots) {
    await sandbox.write(path, content).catch(() => undefined);
  }
}

/** Applies recorded edits to a sandbox tree with the same uniqueness rules as edit_file. */
export async function applyEditsToSandbox(sandbox: Sandbox, edits: RepairEdit[]): Promise<{ ok: boolean; reason?: string }> {
  for (const edit of edits) {
    const content = await sandbox.read(edit.path).catch(() => undefined);
    if (content === undefined) return { ok: false, reason: `missing file ${edit.path}` };
    const count = content.split(edit.find).length - 1;
    if (count !== 1) return { ok: false, reason: `edit for ${edit.path} matches ${count} times on a clean head` };
    await sandbox.write(edit.path, content.replace(edit.find, edit.replace));
  }
  return { ok: true };
}

async function replayRepro(
  finding: Finding,
  sandbox: Sandbox,
  probeDir: string,
): Promise<{ passed: boolean; harnessError: boolean; output: string }> {
  const result = await runArtifact(sandbox, finding.repro.artifact, probeDir, {
    runs: 2,
    expect: "pass",
    target: finding.file.split("/").pop()?.split(".")[0],
  });
  return {
    passed: result.passed,
    harnessError: result.harnessError,
    output: truncate(result.outputs.join("\n---\n"), 2_000),
  };
}

async function runGates(deps: FixDeps): Promise<{ passed: boolean; detail: string }> {
  const gates: string[] = [];
  if (deps.context.profile.typecheckCommand) {
    const result = await deps.sandbox.exec(deps.context.profile.typecheckCommand, { cwd: deps.sandbox.root, timeoutMs: 300_000, allowFailure: true });
    gates.push(`typecheck: exit ${result.exitCode}`);
    if (result.exitCode !== 0) return { passed: false, detail: `typecheck failed (exit ${result.exitCode}): ${truncate(`${result.stdout}\n${result.stderr}`, 800)}` };
  }
  if (deps.context.profile.testCommand) {
    const result = await deps.sandbox.exec(deps.context.profile.testCommand, { cwd: deps.sandbox.root, timeoutMs: 420_000, allowFailure: true });
    gates.push(`tests: exit ${result.exitCode}`);
    if (result.exitCode !== 0) return { passed: false, detail: `repository tests failed (exit ${result.exitCode}): ${truncate(`${result.stdout}\n${result.stderr}`, 800)}` };
  }
  return { passed: true, detail: gates.join(", ") || "no gates configured" };
}

async function refreshContext(questions: string[], deps: FixDeps): Promise<string> {
  const agent = deps.runAgentImpl ?? runAgent;
  const selected = questions.slice(0, deps.refreshResearchers);
  const results = await Promise.all(
    selected.map(async (question, index) => {
      const toolContext: ToolContext = {
        sandbox: deps.sandbox,
        graph: deps.context.graph,
        context: deps.context,
        profile: deps.context.profile,
        probeDir: `${deps.sandbox.root}/.cortado-probes`,
        phase: "refresh",
        logger: deps.logger,
        signal: deps.signal,
      };
      const result = await agent({
        role: "investigator",
        kind: "refresh",
        system: researcherSystem(),
        user: researcherInitial([question], renderSwarmContext(deps.context, { investigator: "context researcher", focus: question })),
        allowedTools: RESEARCHER_TOOLS,
        toolContext,
        transport: deps.transport,
        logger: deps.logger,
        maxTurns: deps.refreshTurns,
        maxToolsPerTurn: 4,
        deadline: deps.deadline,
        signal: deps.signal,
        label: `refresh-${index + 1}`,
        isFinal: (parsed) => Array.isArray(parsed.answers),
      });
      if (!result.final) return `### Question\n${question}\n\nNo grounded answer was produced.`;
      return `### Question\n${question}\n\n${truncate(JSON.stringify(result.final.answers, null, 2), 2_400)}`;
    }),
  );
  return ["## Refreshed context (from a focused read-only search)", ...results].join("\n\n");
}

async function diagnose(
  finding: Finding,
  attempt: FixAttempt,
  deps: FixDeps,
): Promise<string[]> {
  try {
    const response = await deps.transport.complete({
      role: "engineer",
      kind: "diagnose",
      system: diagnosisSystem(deps.diagnosisQuestions),
      user: diagnosisUser({
        claim: finding.claim,
        attempt: attempt.attempt,
        failureCategory: attempt.failureCategory ?? "unknown",
        failureDetail: attempt.failureDetail ?? attempt.summary,
      }),
      expectJson: true,
      retries: 1,
      signal: deps.signal,
      label: `diagnose-${finding.id}-a${attempt.attempt}`,
    });
    const parsed = JSON.parse(response.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")) as { questions?: unknown };
    if (!Array.isArray(parsed.questions)) return [];
    return parsed.questions.filter((question): question is string => typeof question === "string").slice(0, deps.diagnosisQuestions);
  } catch (error) {
    deps.logger.warn(`diagnosis failed for ${finding.id}`, { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

export async function fixStage(findings: Finding[], deps: FixDeps): Promise<FixResult> {
  const agent = deps.runAgentImpl ?? runAgent;
  const probeDir = `${deps.sandbox.root}/.cortado-probes`;
  const candidates: CandidateRecord[] = [];
  const ordered = [...findings].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  for (const finding of ordered) {
    if (Date.now() > deps.globalDeadline || deps.transport.usage.calls >= deps.transport.maxCalls || deps.budgetExhausted?.()) {
      finding.fix = { state: "skipped", reason: "budget was exhausted before this finding could be fixed", attempts: [] };
      candidates.push({ candidateId: finding.id, claim: finding.claim, severity: finding.severity, file: finding.file, state: "deferred", reason: finding.fix.reason });
      continue;
    }

    const snapshots = new Map<string, string>();
    const edits: RepairEdit[] = [];
    const attempts: FixAttempt[] = [];
    let continuation: string | undefined;
    let success = false;
    let lastFailure: FixAttempt | undefined;

    for (let attemptNumber = 1; attemptNumber <= deps.attempts; attemptNumber += 1) {
      snapshots.clear();
      edits.length = 0;
      await deps.sandbox.write(`${probeDir}/${finding.repro.artifact.path}`, finding.repro.artifact.content);
      const toolContext: ToolContext = {
        sandbox: deps.sandbox,
        graph: deps.context.graph,
        context: deps.context,
        profile: deps.context.profile,
        probeDir,
        phase: "fix",
        logger: deps.logger,
        signal: deps.signal,
        snapshot: (path, content) => {
          if (!snapshots.has(path)) snapshots.set(path, content);
        },
        recordEdit: (edit) => edits.push(edit),
      };

      const started = Date.now();
      const result: AgentRunResult = await agent({
        role: "engineer",
        kind: "fix",
        system: engineerSystem(),
        user: engineerInitial(renderFindingContext(deps.context, finding), attemptNumber, deps.attempts, continuation),
        allowedTools: ENGINEER_TOOLS,
        toolContext,
        transport: deps.transport,
        logger: deps.logger,
        maxTurns: deps.maxTurns,
        maxToolsPerTurn: deps.maxToolsPerTurn,
        deadline: deps.deadline,
        signal: deps.signal,
        label: `fix-${finding.id}-a${attemptNumber}`,
      });
      toolContext.stopApp?.().catch(() => undefined);

      const summary = result.stoppedReason;
      const attempt: FixAttempt = {
        attempt: attemptNumber,
        summary,
        edits: [...edits],
        turns: result.turns,
        toolCalls: result.toolCalls,
        durationMs: Date.now() - started,
      };

      const budgetStop = /budget|cost/i.test(summary);
      if (budgetStop) {
        attempt.failureCategory = "budget";
        attempt.failureDetail = summary;
        attempts.push(attempt);
        lastFailure = attempt;
        await restore(deps.sandbox, snapshots);
        break;
      }

      if (edits.length === 0) {
        attempt.failureCategory = "no_edit";
        attempt.failureDetail = "the engineer produced no file edits";
      } else if (!assessEdits(edits).ok) {
        attempt.failureCategory = "unsafe_edit";
        attempt.failureDetail = assessEdits(edits).reason;
      } else {
        const replay = await replayRepro(finding, deps.sandbox, probeDir);
        if (!replay.passed) {
          attempt.failureCategory = replay.harnessError ? "sandbox_error" : "repro_still_fails";
          attempt.failureDetail = replay.output;
        } else {
          const gates = await runGates(deps);
          if (!gates.passed) {
            attempt.failureCategory = "gate_failed";
            attempt.failureDetail = gates.detail;
          } else {
            attempt.summary = "repro passes and gates pass";
            attempts.push(attempt);
            success = true;
            break;
          }
        }
      }

      attempts.push(attempt);
      lastFailure = attempt;

      if (attemptNumber < deps.attempts && Date.now() < deps.deadline) {
        const questions = await diagnose(finding, attempt, deps);
        if (questions.length > 0) {
          const refreshed = await refreshContext(questions, deps);
          continuation = [
            "## Why the previous attempt failed",
            `Category: ${attempt.failureCategory ?? "unknown"}`,
            truncate(attempt.failureDetail ?? attempt.summary, 1_800),
            refreshed,
          ].join("\n\n");
        } else {
          continuation = [
            "## Why the previous attempt failed",
            `Category: ${attempt.failureCategory ?? "unknown"}`,
            truncate(attempt.failureDetail ?? attempt.summary, 1_800),
            "No refreshed context was available; change your approach directly based on the failure.",
          ].join("\n\n");
        }
      }
      await restore(deps.sandbox, snapshots);
    }

    if (success) {
      const patchParts: string[] = [];
      for (const edit of edits) {
        const snapshot = snapshots.get(edit.path);
        const current = await deps.sandbox.read(edit.path).catch(() => undefined);
        if (snapshot !== undefined && current !== undefined && snapshot !== current) {
          patchParts.push(unifiedDiffFromEdits(edit.path, snapshot, [{ find: edit.find, replace: edit.replace }]));
        }
      }
      finding.fix = {
        state: "pending_verify",
        reason: "the reproduction passes and the repository gates pass; independent verification is pending",
        patch: patchParts.join("\n"),
        edits: [...edits],
        attempts,
      };
      deps.logger.info(`fix ${finding.id}: repro passes after ${attempts.length} attempt(s)`);
    } else {
      finding.state = "fix_failed";
      finding.fix = {
        state: "failed",
        reason: lastFailure?.failureCategory === "budget" ? "budget exhausted during repair" : `repair failed: ${lastFailure?.failureCategory ?? "unknown"}`,
        patch: undefined,
        edits: [],
        attempts,
      };
      candidates.push({
        candidateId: finding.id,
        claim: finding.claim,
        severity: finding.severity,
        file: finding.file,
        state: lastFailure?.failureCategory === "budget" ? "deferred" : "fix_failed",
        reason: finding.fix.reason,
      });
      deps.logger.info(`fix ${finding.id}: failed after ${attempts.length} attempt(s) — ${finding.fix.reason}`);
      await restore(deps.sandbox, snapshots);
    }
  }

  return { findings, candidates };
}

function severityRank(severity: string): number {
  return { critical: 5, high: 4, medium: 3, low: 2, info: 1 }[severity] ?? 1;
}
