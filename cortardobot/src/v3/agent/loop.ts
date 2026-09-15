import { z } from "zod";
import type {
  AgentTurn,
  AuthoredProbe,
  Candidate,
  ContextPack,
  FailureCategory,
  FailureReport,
  ModelMessage,
  PRContext,
  ProofResult,
  RepairAttempt,
  RepairEdit,
  RepairExit,
  ToolCall,
  ToolObservation,
} from "../types";
import type { RepoProfile, Sandbox } from "../sandbox";
import type { ModelRouter } from "../models";
import { extractJson, hashContent, stableStringify, truncate, type Logger } from "../util";
import { assessEdits } from "../safety";
import { unifiedDiffFromEdits } from "../patch";
import { TranscriptRecorder, renderObservations } from "./transcript";
import { renderContextPack } from "./context-pack";
import { executeTool, type ToolContext } from "./tools";
import { continueTurnPrompt, diagnosisSystemPrompt, diagnosisUserPrompt, initialTurnPrompt, repairAgentSystemPrompt } from "./prompts";

const actionSchema = z.object({
  thought: z.string().max(800).optional().default(""),
  actions: z
    .array(
      z.object({
        tool: z.string().min(1),
        args: z.record(z.unknown()).optional().default({}),
      }),
    )
    .max(6)
    .optional()
    .default([]),
  strategy: z.string().max(300).optional(),
  rationale: z.string().max(700).optional(),
  done: z.boolean().optional().default(false),
  summary: z.string().max(600).optional(),
});

/** Shared across every finding in one run so failed strategies and lessons carry over. */
export interface RepairRunMemory {
  /** Edit hashes that already failed anywhere in this run. */
  blockedEdits: Set<string>;
  /** Short "what we learned" notes from earlier diagnosed failures. */
  notes: string[];
}

export function createRepairRunMemory(): RepairRunMemory {
  return { blockedEdits: new Set(), notes: [] };
}

const MAX_RUN_NOTES = 6;

export function rememberRepairLesson(memory: RepairRunMemory | undefined, lesson: string): void {
  if (!memory) return;
  memory.notes.push(lesson);
  if (memory.notes.length > MAX_RUN_NOTES) memory.notes.splice(0, memory.notes.length - MAX_RUN_NOTES);
}

export interface AgentLoopDeps {
  sandbox: Sandbox;
  profile: RepoProfile;
  models: ModelRouter;
  candidate: Candidate;
  context: PRContext;
  proof: ProofResult;
  contextPack: ContextPack;
  originalContent: string;
  logger: Logger;
  maxAttempts: number;
  maxTurns: number;
  maxToolsPerTurn: number;
  proveCandidate: () => Promise<ProofResult>;
  /** Per-run memory shared across findings (3.2). */
  memory?: RepairRunMemory;
  now?: () => number;
}

export interface AgentLoopOutcome {
  exit: RepairExit;
  attempts: RepairAttempt[];
  finalEdits?: RepairEdit[];
  finalPatch?: string;
  /** Last pre-fix failing probe from the successful attempt (3.2). */
  probe?: AuthoredProbe;
  reason: string;
  transcript: ReturnType<TranscriptRecorder["snapshot"]>;
  toolCalls: number;
  turns: number;
}

async function restoreFile(sandbox: Sandbox, path: string, content: string): Promise<void> {
  await sandbox.write(path, content).catch(() => undefined);
}

/**
 * Restores every file an attempt touched (not just the candidate file) plus the
 * candidate file itself. Multi-file edits must never leak into the next attempt.
 */
async function restoreAttempt(
  sandbox: Sandbox,
  snapshot: Map<string, string>,
  fallbackPath: string,
  fallbackContent: string,
): Promise<void> {
  for (const [path, content] of snapshot) await restoreFile(sandbox, path, content);
  if (!snapshot.has(fallbackPath)) await restoreFile(sandbox, fallbackPath, fallbackContent);
}

const diagnosisSchema = z.object({
  category: z
    .enum([
      "apply_failed",
      "no_edit",
      "test_failed",
      "typecheck_failed",
      "reproduction_still_confirms",
      "harness_error",
      "model_error",
      "timeout",
      "unsafe",
    ])
    .optional(),
  reason: z.string().min(4).max(600),
  nextStrategy: z.string().min(4).max(300),
});

function deterministicStrategy(category: FailureCategory): string {
  switch (category) {
    case "reproduction_still_confirms":
      return "target a different root cause: the previous edit did not change the failing behavior";
    case "harness_error":
      return "do not rely on the harness result; verify by reading the code and make the next edit smaller";
    case "no_edit":
      return "produce one concrete minimal edit; do not finish without a verified fix";
    case "apply_failed":
      return "re-read the exact current file content and rebuild the find string byte-for-byte";
    case "unsafe":
      return "avoid restricted paths and never weaken or remove test assertions";
    case "model_error":
      return "retry with a smaller, more targeted request";
    case "timeout":
      return "make the next attempt smaller and more targeted";
    case "test_failed":
      return "keep the failing test as the target and fix the code the test exercises";
    case "typecheck_failed":
      return "resolve the type error without weakening types";
    default:
      return "change the approach materially";
  }
}

/** Deterministic failure classification used when no diagnosis call is made. */
export function classifyFailure(record: RepairAttempt): FailureReport {
  const applyReason = record.applyReason ?? "";
  const output = record.testOutput ?? "";
  const files = [...new Set(record.edits.map((edit) => edit.path))];
  const report = (category: FailureCategory, summary: string, nextStrategy = deterministicStrategy(category)): FailureReport => ({
    category,
    summary,
    evidence: truncate(output || applyReason, 1_800),
    files,
    nextStrategy,
  });

  if (/model call failed/i.test(applyReason)) return report("model_error", `the model call failed: ${truncate(applyReason, 240)}`);
  if (/turn budget/i.test(applyReason)) return report("timeout", "the attempt ran out of turns before landing a verified fix");
  if (/unsafe|restricted|weaken/i.test(applyReason)) return report("unsafe", `the edit was rejected as unsafe: ${truncate(applyReason, 240)}`);
  if (/apply failed|ambiguous|not found|postcondition|no-op|did not apply/i.test(applyReason)) {
    return report("apply_failed", `the edit did not apply cleanly: ${truncate(applyReason, 240)}`);
  }
  if (/invalid JSON|no actions|no usable edit|agent finished|no edit/i.test(applyReason)) {
    return report("no_edit", `the agent produced no usable edit: ${truncate(applyReason, 240)}`);
  }
  if (record.applied && !record.testPassed) {
    if (/inconclusive|harness error|could not run|no executable proof/i.test(output)) {
      return report("harness_error", `the reproduction was inconclusive after the edit: ${truncate(output, 240)}`);
    }
    return report("reproduction_still_confirms", `the edit applied but the defect still reproduces: ${truncate(output, 240)}`);
  }
  return report("no_edit", `the attempt did not land a verified fix: ${truncate(applyReason || output, 240)}`);
}

export interface DiagnoseInput {
  candidate: Candidate;
  attempt: number;
  maxAttempts: number;
  record: RepairAttempt;
  originalContent: string;
  models: ModelRouter;
  logger: Logger;
}

const SEMANTIC_FAILURES: ReadonlySet<FailureCategory> = new Set(["reproduction_still_confirms", "harness_error", "no_edit"]);

/**
 * Builds the structured failure report for a failed attempt. For semantic
 * failures (the fix applied but did not work, or no edit was produced) Terra is
 * asked why and what to try instead; everything else is classified
 * deterministically so a broken gateway never burns extra calls.
 */
export async function diagnoseFailure(input: DiagnoseInput): Promise<FailureReport> {
  const base = classifyFailure(input.record);
  const file = input.candidate.file;
  const attemptedDiff =
    input.record.applied && file && input.record.edits.length > 0
      ? unifiedDiffFromEdits(file, input.originalContent, input.record.edits).slice(0, 2_000)
      : undefined;
  const failure: FailureReport = { ...base, attemptedDiff };
  if (!SEMANTIC_FAILURES.has(failure.category) || input.attempt >= input.maxAttempts) return failure;
  try {
    const response = await input.models.complete({
      role: "terra",
      kind: "diagnosis",
      system: diagnosisSystemPrompt(),
      user: diagnosisUserPrompt({ claim: input.candidate.claim, attempt: input.attempt, maxAttempts: input.maxAttempts, failure }),
      expectJson: true,
      maxTokens: 800,
      label: `diagnosis-${input.candidate.id}-a${input.attempt}`,
    });
    const parsed = diagnosisSchema.safeParse(extractJson(response.text));
    if (!parsed.success) {
      input.logger.warn(`diagnosis produced invalid JSON for ${input.candidate.id}`, { error: parsed.error.message.slice(0, 200) });
      return failure;
    }
    return {
      ...failure,
      category: parsed.data.category ?? failure.category,
      summary: parsed.data.reason,
      nextStrategy: parsed.data.nextStrategy,
    };
  } catch (error) {
    input.logger.warn(`diagnosis call failed for ${input.candidate.id}`, { error: error instanceof Error ? error.message : String(error) });
    return failure;
  }
}

export async function runRepairAgent(deps: AgentLoopDeps): Promise<AgentLoopOutcome> {
  const now = deps.now ?? (() => Date.now());
  const candidate = deps.candidate;
  const file = candidate.file!;
  const recorder = new TranscriptRecorder(candidate.id);
  const attempts: RepairAttempt[] = [];
  const failedEditHashes = new Set<string>(deps.memory?.blockedEdits ?? []);
  let previousDiagnosis: string | undefined;
  let previousFailure: FailureReport | undefined;
  let promotedProbe: AuthoredProbe | undefined;
  let totalTurns = 0;
  let unsafeRejections = 0;

  const runModelDrivenAttempt = async (attempt: number): Promise<RepairAttempt | undefined> => {
    const messages: ModelMessage[] = [];
    const appliedEdits: RepairEdit[] = [];
    const attemptProbes: AuthoredProbe[] = [];
    const beforeSnapshot = new Map<string, string>();
    const toolContext: ToolContext = {
      sandbox: deps.sandbox,
      profile: deps.profile,
      candidate,
      context: deps.context,
      pack: deps.contextPack,
      logger: deps.logger,
      probeDir: `${deps.sandbox.root}/.cortado-probes`,
      runReproduction: deps.proveCandidate,
      recordAppliedEdits: (edits) => appliedEdits.push(...edits),
      recordProbe: (probe) => attemptProbes.push(probe),
    };

    let nextUser = initialTurnPrompt(
      renderContextPack(deps.contextPack),
      `Defect: ${candidate.claim}\nSeverity: ${candidate.severity} | Evidence: ${candidate.evidence.join(", ")}`,
      { attempt, maxAttempts: deps.maxAttempts, previousDiagnosis, previousFailure, runNotes: deps.memory?.notes.slice(-4) },
    );
    let attemptTurns = 0;
    let attemptTools = 0;
    let lastStrategy = "none";
    let appliedThisAttempt: RepairEdit[] = [];
    let invalidTurns = 0;

    for (let turn = 1; turn <= deps.maxTurns; turn++) {
      attemptTurns += 1;
      totalTurns += 1;
      const history = messages;
      const user = nextUser;
      let raw = "";
      try {
        const response = await deps.models.complete({
          role: "terra",
          kind: "repair_agent",
          system: repairAgentSystemPrompt(),
          user,
          history,
          expectJson: true,
          maxTokens: 7000,
          label: `repair-agent-${candidate.id}-a${attempt}-t${turn}`,
        });
        raw = response.text;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        deps.logger.warn(`repair agent model call failed for ${candidate.id}`, { error: message });
        const record: RepairAttempt = {
          attempt,
          strategy: lastStrategy,
          edits: appliedThisAttempt,
          applied: appliedThisAttempt.length > 0,
          applyReason: `model call failed: ${message}`,
          testPassed: false,
          turns: attemptTurns,
          tools: attemptTools,
        };
        attempts.push(record);
        return record;
      }

      const parsed = actionSchema.safeParse(extractJson(raw));
      if (!parsed.success) {
        invalidTurns += 1;
        deps.logger.warn(`repair agent produced invalid JSON for ${candidate.id}`, { error: parsed.error.message.slice(0, 200) });
        if (invalidTurns >= 2) {
          const record: RepairAttempt = {
            attempt,
            strategy: lastStrategy,
            edits: appliedThisAttempt,
            applied: appliedThisAttempt.length > 0,
            applyReason: "agent produced invalid JSON twice",
            testPassed: false,
            turns: attemptTurns,
            tools: attemptTools,
          };
          attempts.push(record);
          return record;
        }
        messages.push({ role: "user", content: user });
        messages.push({ role: "assistant", content: raw.slice(0, 400) });
        nextUser = continueTurnPrompt("(invalid JSON; return a single JSON action object)");
        continue;
      }

      const action = parsed.data;
      if (action.strategy) lastStrategy = action.strategy;
      const calls: ToolCall[] = (action.actions ?? []).slice(0, deps.maxToolsPerTurn).map((entry) => ({
        tool: entry.tool as ToolCall["tool"],
        args: (entry.args ?? {}) as Record<string, unknown>,
      }));

      if (action.done || calls.some((call) => call.tool === "finish")) {
        const reason = action.summary ?? "agent finished without a verified fix";
        const record: RepairAttempt = {
          attempt,
          strategy: lastStrategy,
          edits: appliedThisAttempt,
          applied: appliedThisAttempt.length > 0,
          applyReason: reason,
          testPassed: false,
          turns: attemptTurns,
          tools: attemptTools,
        };
        attempts.push(record);
        previousDiagnosis = reason;
        await restoreAttempt(deps.sandbox, beforeSnapshot, file, deps.originalContent);
        return record;
      }

      if (calls.length === 0) {
        invalidTurns += 1;
        if (invalidTurns >= 2) {
          const record: RepairAttempt = {
            attempt,
            strategy: lastStrategy,
            edits: appliedThisAttempt,
            applied: appliedThisAttempt.length > 0,
            applyReason: "agent returned no actions",
            testPassed: false,
            turns: attemptTurns,
            tools: attemptTools,
          };
          attempts.push(record);
          return record;
        }
        messages.push({ role: "user", content: user });
        messages.push({ role: "assistant", content: raw.slice(0, 400) });
        nextUser = continueTurnPrompt("(no actions returned; call a tool or finish)");
        continue;
      }

      const observations: ToolObservation[] = [];
      let reproductionObservation: ToolObservation | undefined;
      for (const call of calls) {
        attemptTools += 1;
        const args = call.args as Record<string, unknown>;
        if (call.tool === "apply_edit" && Array.isArray(args.edits)) {
          const edits = args.edits as RepairEdit[];
          for (const edit of edits) {
            if (typeof edit?.path !== "string" || beforeSnapshot.has(edit.path)) continue;
            const prior = await deps.sandbox.read(edit.path).catch(() => undefined);
            if (prior !== undefined) beforeSnapshot.set(edit.path, prior);
          }
          const editHash = hashContent(stableStringify(edits));
          if (failedEditHashes.has(editHash)) {
            observations.push({
              tool: call.tool,
              ok: false,
              summary: "duplicate edit rejected",
              detail: "This exact edit already failed. Change the approach materially.",
              durationMs: 0,
            });
            continue;
          }
          const result = await executeTool(call, toolContext);
          observations.push(result);
          if (!result.ok) {
            failedEditHashes.add(editHash);
            deps.memory?.blockedEdits.add(editHash);
            if (/unsafe|restricted|weaken/i.test(result.summary)) unsafeRejections += 1;
          }
        } else {
          const result = await executeTool(call, toolContext);
          observations.push(result);
          if (call.tool === "run_reproduction") reproductionObservation = result;
        }
      }

      recorder.addTurn({
        turn,
        thought: action.thought,
        actions: calls,
        observations,
        modelId: deps.models.idFor("terra"),
        durationMs: 0,
      });

      messages.push({ role: "user", content: user });
      messages.push({ role: "assistant", content: raw.slice(0, 1_200) });
      nextUser = continueTurnPrompt(renderObservations(observations));

      const newEdits = appliedEdits.filter((edit) => !appliedThisAttempt.includes(edit));
      if (newEdits.length > 0) {
        appliedThisAttempt = [...appliedThisAttempt, ...newEdits];
        const proof = reproductionObservation?.ok ? undefined : await deps.proveCandidate();
        const confirmed = reproductionObservation ? !reproductionObservation.ok : proof!.status === "confirmed" || proof!.status === "error" || proof!.status === "likely";
        if (!confirmed) {
          promotedProbe = [...attemptProbes].reverse().find((probe) => !probe.passed);
          const record: RepairAttempt = {
            attempt,
            strategy: lastStrategy,
            edits: appliedThisAttempt,
            applied: true,
            testPassed: true,
            testOutput: proof?.explanation ?? reproductionObservation?.detail,
            exit: "VERIFIED",
            turns: attemptTurns,
            tools: attemptTools,
          };
          attempts.push(record);
          return record;
        }
        const record: RepairAttempt = {
          attempt,
          strategy: lastStrategy,
          edits: appliedThisAttempt,
          applied: true,
          testPassed: false,
          testOutput: proof?.explanation ?? reproductionObservation?.detail,
          turns: attemptTurns,
          tools: attemptTools,
        };
        attempts.push(record);
        previousDiagnosis =
          proof?.status === "confirmed"
            ? `The edit applied but the defect still reproduces: ${proof.explanation}. Re-read the current file and target a different root cause.`
            : `The reproduction was inconclusive after the edit (${proof?.status ?? "harness error"}): ${proof?.explanation ?? reproductionObservation?.detail}. Do not claim success; change strategy.`;
        await restoreAttempt(deps.sandbox, beforeSnapshot, file, deps.originalContent);
        return record;
      }

      if (reproductionObservation && !reproductionObservation.ok) {
        previousDiagnosis = `The authoritative reproduction still fails: ${reproductionObservation.detail}. Change strategy.`;
      }

      if (turn === deps.maxTurns) {
        const record: RepairAttempt = {
          attempt,
          strategy: lastStrategy,
          edits: appliedThisAttempt,
          applied: appliedThisAttempt.length > 0,
          applyReason: "turn budget exhausted before a verified fix",
          testPassed: false,
          turns: attemptTurns,
          tools: attemptTools,
        };
        attempts.push(record);
        previousDiagnosis = "The turn budget was exhausted. Make the next attempt smaller and more targeted.";
        await restoreAttempt(deps.sandbox, beforeSnapshot, file, deps.originalContent);
        return record;
      }
    }
    return undefined;
  };

  const cleanupProbes = async (): Promise<void> => {
    await deps.sandbox
      .exec(`rm -rf ${deps.sandbox.root}/.cortado-probes`, { cwd: deps.sandbox.root, timeoutMs: 15_000, allowFailure: true })
      .catch(() => undefined);
  };

  let success: RepairAttempt | undefined;
  for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
    const before = attempts.length;
    const record = await runModelDrivenAttempt(attempt);
    await cleanupProbes();
    if (record?.exit === "VERIFIED") {
      success = record;
      break;
    }
    if (attempts.length === before) {
      attempts.push({ attempt, strategy: "none", edits: [], applied: false, applyReason: "agent produced no usable edit", testPassed: false });
    }
    const failed = attempts[attempts.length - 1];
    if (failed) {
      const failure = await diagnoseFailure({
        candidate,
        attempt,
        maxAttempts: deps.maxAttempts,
        record: failed,
        originalContent: deps.originalContent,
        models: deps.models,
        logger: deps.logger,
      });
      failed.failure = failure;
      failed.diagnosis = failure.summary;
      previousFailure = failure;
      previousDiagnosis = failure.nextStrategy ? `${failure.summary}\nNext strategy: ${failure.nextStrategy}` : failure.summary;
      rememberRepairLesson(
        deps.memory,
        `${candidate.file ?? candidate.id}: ${failure.summary}${failure.nextStrategy ? ` Next: ${failure.nextStrategy}` : ""}`,
      );
    }
  }

  if (!success && candidate.autoFix && candidate.autoFix.length > 0) {
    const edits = candidate.autoFix;
    const safety = assessEdits(edits);
    if (safety.ok) {
      const autoFixSnapshot = new Map<string, string>();
      for (const edit of edits) {
        const prior = await deps.sandbox.read(edit.path).catch(() => undefined);
        if (prior !== undefined) autoFixSnapshot.set(edit.path, prior);
      }
      const apply = await deps.sandbox.applyEdits(edits);
      if (apply.ok) {
        const proof = await deps.proveCandidate();
        const record: RepairAttempt = {
          attempt: deps.maxAttempts + 1,
          strategy: "deterministic root-cause fix derived from the diff",
          edits,
          applied: true,
          testPassed: proof.status === "disproven",
          testOutput: proof.explanation,
          ...(proof.status === "disproven" ? { exit: "VERIFIED" as const } : {}),
        };
        attempts.push(record);
        if (proof.status === "disproven") success = record;
        else await restoreAttempt(deps.sandbox, autoFixSnapshot, file, deps.originalContent);
      } else {
        await restoreAttempt(deps.sandbox, autoFixSnapshot, file, deps.originalContent);
        attempts.push({
          attempt: deps.maxAttempts + 1,
          strategy: "deterministic root-cause fix derived from the diff",
          edits,
          applied: false,
          applyReason: apply.failed.map((entry) => entry.reason).join("; "),
          testPassed: false,
        });
      }
    }
  }

  if (success?.exit === "VERIFIED") {
    const finalPatch = unifiedDiffFromEdits(file, deps.originalContent, success.edits);
    return {
      exit: "VERIFIED",
      attempts,
      finalEdits: success.edits,
      finalPatch,
      probe: promotedProbe,
      reason: `fix applied and the reproduction passes after ${success.attempt} attempt(s)`,
      transcript: recorder.snapshot(),
      toolCalls: recorder.count,
      turns: totalTurns,
    };
  }

  await restoreFile(deps.sandbox, file, deps.originalContent);
  const exit: RepairExit =
    unsafeRejections > 0 && attempts.length > 0 && attempts.every((attempt) => /unsafe|restricted|weaken/i.test(attempt.applyReason ?? ""))
      ? "UNSAFE"
      : "UNRESOLVED";
  return {
    exit,
    attempts,
    reason: exit === "UNSAFE" ? "all proposed fixes were rejected as unsafe" : `fix not verified within ${deps.maxAttempts} attempt(s)`,
    transcript: recorder.snapshot(),
    toolCalls: recorder.count,
    turns: totalTurns,
  };
}
