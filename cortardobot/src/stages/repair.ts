import type { CortadoConfig } from "../config";
import type {
  MergedCandidate,
  PRContext,
  ProofResult,
  RepairAttempt,
  RepairExitState,
  RepairResult,
} from "../types";
import { extractJson } from "../util/json";
import { parseUnifiedDiff } from "../util/diff";
import { diagnosisSchema, repairPatchSchema, repairPlanSchema } from "../agents/contracts";
import { diagnosisSystemPrompt, diagnosisUserPrompt, repairPatchSystemPrompt, repairPatchUserPrompt, repairPlanSystemPrompt, repairPlanUserPrompt } from "../agents/prompts";
import { assessPatchSafety } from "../sandbox/safety";
import type { Sandbox } from "../sandbox";
import type { Logger } from "../util/logger";
import type { ModelRouter } from "../models/router";
import { discoverTests, type RepoCommands } from "./proof";

export interface RepairDeps {
  sandbox: Sandbox;
  models: ModelRouter;
  config: CortadoConfig;
  commands: RepoCommands;
  logger: Logger;
  now?: () => number;
}

export async function repairFindings(
  proofs: ProofResult[],
  candidates: MergedCandidate[],
  context: PRContext,
  deps: RepairDeps,
): Promise<RepairResult[]> {
  const now = deps.now ?? (() => Date.now());
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const confirmed = proofs.filter((proof) => proof.status === "confirmed");
  const results: RepairResult[] = [];

  for (const proof of confirmed) {
    const candidate = byId.get(proof.candidateId);
    if (!candidate) continue;
    results.push(await repairCandidate(candidate, proof, context, deps, now));
  }
  return results;
}

async function repairCandidate(
  candidate: MergedCandidate,
  proof: ProofResult,
  context: PRContext,
  deps: RepairDeps,
  now: () => number,
): Promise<RepairResult> {
  const started = now();
  const toolCallsAtStart = deps.sandbox.toolCalls;
  const attempts: RepairAttempt[] = [];
  const fileContents = await gatherRelevantFiles(candidate, context, deps.sandbox);
  let finalPatch: string | undefined;
  let exit: RepairExitState | undefined;
  let reason = "";
  let previousDiagnosis: string | undefined;

  if (Object.keys(fileContents).length === 0) {
    return {
      candidateId: candidate.id,
      severity: candidate.severity,
      exit: "UNRESOLVED",
      attempts,
      durationMs: now() - started,
      toolCalls: deps.sandbox.toolCalls - toolCallsAtStart,
      reason: "no relevant files were available in the sandbox",
    };
  }

  for (let attemptNumber = 1; attemptNumber <= deps.config.repair.maxAttempts; attemptNumber++) {
    if (now() - started > deps.config.repair.maxTimeMs) {
      exit = "BUDGET_EXHAUSTED";
      reason = `repair exceeded ${deps.config.repair.maxTimeMs}ms budget`;
      break;
    }
    if (deps.sandbox.toolCalls - toolCallsAtStart >= deps.config.repair.maxToolCalls) {
      exit = "BUDGET_EXHAUSTED";
      reason = `repair exceeded ${deps.config.repair.maxToolCalls} tool calls`;
      break;
    }

    const plan = await planRepair(candidate, proof, fileContents, attemptNumber, previousDiagnosis, deps);
    const patchResult = await generatePatch(candidate, plan.strategy, fileContents, attemptNumber, deps);
    if (!patchResult.patch) {
      const diagnosis = "the model returned no patch";
      attempts.push({
        attempt: attemptNumber,
        strategy: plan.strategy,
        patch: "",
        applied: false,
        applyReason: diagnosis,
        testPassed: false,
      });
      previousDiagnosis = diagnosis;
      continue;
    }

    const safetyFindings = assessPatchSafety(patchResult.patch, patchLines(patchResult.patch));
    if (safetyFindings.length > 0) {
      const detail = safetyFindings.map((finding) => `${finding.path}: ${finding.reason}`).join("; ");
      attempts.push({
        attempt: attemptNumber,
        strategy: plan.strategy,
        patch: patchResult.patch,
        applied: false,
        applyReason: `rejected as unsafe: ${detail}`,
        testPassed: false,
        exit: "UNSAFE",
      });
      exit = "UNSAFE";
      reason = `patch rejected as unsafe (${detail})`;
      deps.logger.warn(`repair unsafe for ${candidate.id}`, { detail });
      break;
    }

    const applyResult = await deps.sandbox.applyPatch(patchResult.patch);
    if (!applyResult.ok) {
      const applyReason = applyResult.reason ?? "patch did not apply cleanly";
      const diagnosis = await diagnose(candidate, attemptNumber, applyReason, deps);
      attempts.push({
        attempt: attemptNumber,
        strategy: plan.strategy,
        patch: patchResult.patch,
        applied: false,
        applyReason,
        diagnosis,
        testPassed: false,
      });
      previousDiagnosis = diagnosis;
      continue;
    }

    for (const [path] of Object.entries(await deps.sandbox.snapshot())) {
      if (!fileContents[path]) {
        const refreshed = await safeRead(deps.sandbox, path);
        if (refreshed !== undefined) fileContents[path] = refreshed;
      }
    }
    for (const path of Object.keys(fileContents)) {
      const refreshed = await safeRead(deps.sandbox, path);
      if (refreshed !== undefined) fileContents[path] = refreshed;
    }

    const testResult = await runRepairTest(candidate, proof, context, deps);
    if (testResult.passed) {
      attempts.push({
        attempt: attemptNumber,
        strategy: plan.strategy,
        patch: patchResult.patch,
        applied: true,
        testPassed: true,
        testOutput: testResult.output,
        exit: "VERIFIED",
      });
      exit = "VERIFIED";
      finalPatch = patchResult.patch;
      reason = `fix verified after ${attemptNumber} attempt(s)`;
      break;
    }

    const diagnosis = await diagnose(candidate, attemptNumber, testResult.output, deps);
    attempts.push({
      attempt: attemptNumber,
      strategy: plan.strategy,
      patch: patchResult.patch,
      applied: true,
      testPassed: false,
      testOutput: testResult.output,
      diagnosis,
    });
    previousDiagnosis = diagnosis;

    if (deps.sandbox.toolCalls - toolCallsAtStart >= deps.config.repair.maxToolCalls) {
      exit = "BUDGET_EXHAUSTED";
      reason = `repair exceeded ${deps.config.repair.maxToolCalls} tool calls`;
      break;
    }
    if (now() - started > deps.config.repair.maxTimeMs) {
      exit = "BUDGET_EXHAUSTED";
      reason = `repair exceeded ${deps.config.repair.maxTimeMs}ms budget`;
      break;
    }
  }

  if (!exit) {
    exit = "UNRESOLVED";
    reason = `fix not verified within ${deps.config.repair.maxAttempts} attempt(s)`;
  }

  return {
    candidateId: candidate.id,
    severity: candidate.severity,
    exit,
    attempts,
    finalPatch,
    durationMs: now() - started,
    toolCalls: deps.sandbox.toolCalls - toolCallsAtStart,
    reason,
  };
}

async function gatherRelevantFiles(
  candidate: MergedCandidate,
  context: PRContext,
  sandbox: Sandbox,
): Promise<Record<string, string>> {
  const paths = new Set<string>();
  if (candidate.file) paths.add(candidate.file);
  for (const test of (await discoverTests(candidate, context, sandbox)).slice(0, 2)) paths.add(test);
  for (const evidence of candidate.evidence) {
    const path = evidence.split(":")[0];
    if (path) paths.add(path);
  }
  const out: Record<string, string> = {};
  for (const path of paths) {
    const content = await safeRead(sandbox, path);
    if (content !== undefined) out[path] = content;
  }
  return out;
}

async function safeRead(sandbox: Sandbox, path: string): Promise<string | undefined> {
  try {
    if (!(await sandbox.exists(path))) return undefined;
    return await sandbox.read(path);
  } catch {
    return undefined;
  }
}

async function planRepair(
  candidate: MergedCandidate,
  proof: ProofResult,
  fileContents: Record<string, string>,
  attempt: number,
  previousDiagnosis: string | undefined,
  deps: RepairDeps,
): Promise<{ strategy: string; files: string[]; rationale: string }> {
  try {
    const response = await deps.models.complete({
      role: "terra",
      kind: "repair_plan",
      system: repairPlanSystemPrompt(),
      user: repairPlanUserPrompt(candidate, proof.reproduction ?? proof.explanation, fileContents, attempt, previousDiagnosis),
      expectJson: true,
      context: { candidate, attempt, previousDiagnosis, fileContents },
      label: `repair-plan-${candidate.id}-${attempt}`,
    });
    const parsed = repairPlanSchema.parse(extractJson(response.text));
    return {
      strategy: parsed.strategy ?? "Fix the root cause at the mutation point",
      files: parsed.files,
      rationale: parsed.rationale,
    };
  } catch (error) {
    deps.logger.warn(`repair plan fell back for ${candidate.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      strategy:
        attempt === 1
          ? "Patch the root cause at the mutation point"
          : "Change layer after failed attempt",
      files: candidate.file ? [candidate.file] : [],
      rationale: "Fallback plan because the planner returned unusable output",
    };
  }
}

async function generatePatch(
  candidate: MergedCandidate,
  strategy: string,
  fileContents: Record<string, string>,
  attempt: number,
  deps: RepairDeps,
): Promise<{ patch: string; description: string }> {
  try {
    const response = await deps.models.complete({
      role: "terra",
      kind: "repair_patch",
      system: repairPatchSystemPrompt(),
      user: repairPatchUserPrompt(candidate, strategy, fileContents, attempt),
      expectJson: true,
      context: { candidate, attempt, strategy, fileContents },
      label: `repair-patch-${candidate.id}-${attempt}`,
    });
    const parsed = repairPatchSchema.parse(extractJson(response.text));
    return { patch: parsed.patch, description: parsed.description };
  } catch (error) {
    deps.logger.warn(`repair patch fell back for ${candidate.id}`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return { patch: "", description: "no patch" };
  }
}

async function diagnose(
  candidate: MergedCandidate,
  attempt: number,
  testOutput: string,
  deps: RepairDeps,
): Promise<string> {
  try {
    const response = await deps.models.complete({
      role: "terra",
      kind: "repair_diagnosis",
      system: diagnosisSystemPrompt(),
      user: diagnosisUserPrompt(candidate, attempt, testOutput),
      expectJson: true,
      context: { candidate, attempt, testOutput },
      label: `repair-diagnosis-${candidate.id}-${attempt}`,
    });
    const parsed = diagnosisSchema.parse(extractJson(response.text));
    return `${parsed.reason} Next: ${parsed.nextStrategy}`;
  } catch {
    return "The patch did not make the reproduction pass; re-derive the root cause and patch the smallest failing statement.";
  }
}

async function runRepairTest(
  candidate: MergedCandidate,
  proof: ProofResult,
  context: PRContext,
  deps: RepairDeps,
): Promise<{ passed: boolean; output: string }> {
  const checks: Array<{ command: string; evaluate: (result: { exitCode: number; timedOut: boolean; stdout: string; stderr: string }) => boolean }> = [];
  if (proof.strategy === "script" && proof.command) {
    checks.push({
      command: proof.command,
      evaluate: (result) => !result.timedOut && `${result.stdout}${result.stderr}`.includes("CORTADO_SAFE"),
    });
  }
  const test = (await discoverTests(candidate, context, deps.sandbox))[0];
  if (test) {
    checks.push({
      command: deps.commands.testSingle(test),
      evaluate: (result) => !result.timedOut && result.exitCode === 0,
    });
  }
  if (checks.length === 0) {
    checks.push({
      command: deps.commands.test,
      evaluate: (result) => !result.timedOut && result.exitCode === 0,
    });
  }

  const outputs: string[] = [];
  let passed = true;
  for (const check of checks) {
    const result = await deps.sandbox.exec(check.command, {
      timeoutMs: 30_000,
      allowFailure: true,
    });
    outputs.push(`$ ${check.command}\n${result.stdout}${result.stderr}`);
    if (!check.evaluate(result)) passed = false;
  }
  return { passed, output: outputs.join("\n---\n").slice(0, 4000) };
}

export function patchLines(patch: string): Array<{ path: string; removedLines: string[]; addedLines: string[] }> {
  return parseUnifiedDiff(patch).map((filePatch) => ({
    path: filePatch.path,
    removedLines: filePatch.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.type === "-").map((line) => line.text),
    ),
    addedLines: filePatch.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.type === "+").map((line) => line.text),
    ),
  }));
}
