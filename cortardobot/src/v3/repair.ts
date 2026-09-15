import { z } from "zod";
import type { Candidate, PRContext, ProofResult, RepairAttempt, RepairEdit, RepairExit, RepairResult } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";
import type { ModelRouter } from "./models";
import { extractJson, truncate, type Logger } from "./util";
import { renderNumberedFile, unifiedDiffFromEdits } from "./patch";
import { assessEdits } from "./safety";

const repairSchema = z.object({
  strategy: z.string().min(3).max(300),
  rationale: z.string().max(700).optional().default(""),
  edits: z
    .array(
      z.object({
        path: z.string().min(1),
        find: z.string().min(1),
        replace: z.string(),
      }),
    )
    .min(1)
    .max(4),
});

export interface RepairDeps {
  sandbox: Sandbox;
  models: ModelRouter;
  profile: RepoProfile;
  logger: Logger;
  maxAttempts: number;
  maxRepairs: number;
  proveCandidate: (candidate: Candidate) => Promise<ProofResult>;
  now?: () => number;
}

function systemPrompt(): string {
  return [
    "You are Terra, the autonomous repair engineer for an agentic code review bot.",
    "Produce the smallest correct fix for the reported defect.",
    "Return JSON only: {\"strategy\":\"...\",\"rationale\":\"...\",\"edits\":[{\"path\":\"...\",\"find\":\"...\",\"replace\":\"...\"}]}.",
    "Requirements for every edit:",
    "- path must be the exact file path shown in the numbered source below.",
    "- find must be copied verbatim from the numbered source (WITHOUT the line-number prefix) and must appear exactly once in the file.",
    "- replace is the corrected text; use an empty string to delete the matched text.",
    "- Fix the root cause only. Never weaken, delete, or skip tests. Never touch lockfiles, CI workflows, or .env files.",
    "- Prefer one minimal edit. If the defect is an injected debug statement, delete it.",
  ].join("\n");
}

function userPrompt(candidate: Candidate, filePath: string, content: string, proof: ProofResult, previousDiagnosis: string | undefined, attempt: number): string {
  return [
    `## Defect`,
    candidate.claim,
    `Severity: ${candidate.severity} | Confidence: ${candidate.confidence}`,
    `Evidence: ${candidate.evidence.join(", ")}`,
    `Reproduction: ${truncate(proof.reproduction, 900)}`,
    previousDiagnosis ? `## Why the previous attempt failed\n${previousDiagnosis}\nChange your strategy materially.` : "",
    `## Source file ${filePath} (line numbers are NOT part of the file content)`,
    renderNumberedFile(content),
    `## Task`,
    `Attempt ${attempt}. Return the JSON fix for ${filePath} now.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function generateEdits(
  candidate: Candidate,
  filePath: string,
  content: string,
  proof: ProofResult,
  previousDiagnosis: string | undefined,
  attempt: number,
  deps: RepairDeps,
): Promise<{ strategy: string; rationale: string; edits: RepairEdit[] } | undefined> {
  const response = await deps.models.complete({
    role: "terra",
    kind: "repair",
    system: systemPrompt(),
    user: userPrompt(candidate, filePath, content, proof, previousDiagnosis, attempt),
    expectJson: true,
    maxTokens: 6000,
    label: `repair-${candidate.id}-attempt-${attempt}`,
  });
  const parsed = repairSchema.safeParse(extractJson(response.text));
  if (!parsed.success) {
    deps.logger.warn(`repair produced invalid JSON for ${candidate.id}`, { error: parsed.error.message.slice(0, 200) });
    return undefined;
  }
  return { strategy: parsed.data.strategy, rationale: parsed.data.rationale ?? "", edits: parsed.data.edits };
}

async function diagnose(candidate: Candidate, output: string, models: ModelRouter, logger: Logger): Promise<string> {
  try {
    const response = await models.complete({
      role: "terra",
      kind: "repair_diagnosis",
      system:
        'You are Terra diagnosing a failed repair. Explain precisely why the fix did not work and propose a materially different strategy. Return JSON only: {"reason":"...","nextStrategy":"..."}.',
      user: `Defect: ${candidate.claim}\nEvidence: ${candidate.evidence.join(", ")}\nObserved after applying the fix:\n${truncate(output, 2200)}`,
      expectJson: true,
      label: `diagnosis-${candidate.id}`,
    });
    const parsed = z
      .object({ reason: z.string().max(500), nextStrategy: z.string().max(400) })
      .safeParse(extractJson(response.text));
    if (parsed.success) return `${parsed.data.reason} Next: ${parsed.data.nextStrategy}`;
  } catch (error) {
    logger.warn(`diagnosis failed for ${candidate.id}`, { error: error instanceof Error ? error.message : String(error) });
  }
  return "The fix did not make the reproduction pass. Re-read the exact current file content and change the approach materially.";
}

export async function repairFindings(
  confirmed: ProofResult[],
  candidates: Candidate[],
  context: PRContext,
  deps: RepairDeps,
): Promise<RepairResult[]> {
  const now = deps.now ?? (() => Date.now());
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const results: RepairResult[] = [];

  for (const proof of confirmed) {
    const candidate = byId.get(proof.candidateId);
    if (!candidate) continue;
    if (results.length >= deps.maxRepairs) break;
    if (!candidate.file) continue;
    const started = now();
    const attempts: RepairAttempt[] = [];
    let exit: RepairExit | undefined;
    let reason = "";
    let finalEdits: RepairEdit[] | undefined;
    let finalPatch: string | undefined;
    let previousDiagnosis: string | undefined;
    let originalContent = "";

    try {
      originalContent = await deps.sandbox.read(candidate.file);
    } catch (error) {
      results.push({
        candidateId: candidate.id,
        severity: candidate.severity,
        exit: "UNRESOLVED",
        attempts,
        durationMs: now() - started,
        toolCalls: 0,
        reason: `could not read ${candidate.file}: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    for (let attempt = 1; attempt <= deps.maxAttempts; attempt++) {
      if (exit) break;
      const content = await deps.sandbox.read(candidate.file).catch(() => originalContent);
      let generated:
        | { strategy: string; rationale: string; edits: RepairEdit[] }
        | undefined;
      try {
        generated = await generateEdits(candidate, candidate.file, content, proof, previousDiagnosis, attempt, deps);
      } catch (error) {
        deps.logger.warn(`repair model call failed for ${candidate.id}`, { error: error instanceof Error ? error.message : String(error) });
      }

      if (attempt >= 2 && candidate.autoFix && candidate.autoFix.length > 0) {
        deps.logger.info(`using deterministic fix for ${candidate.id} after a failed model attempt`);
        generated = { strategy: "Apply the deterministic root-cause fix derived from the diff", rationale: "Engine-derived exact edit", edits: candidate.autoFix };
      }
      if (!generated || generated.edits.length === 0) {
        attempts.push({ attempt, strategy: "none", edits: [], applied: false, applyReason: "model returned no editable fix", testPassed: false });
        previousDiagnosis = "The model returned no usable edit. Produce a minimal exact find/replace edit copied from the current numbered file content.";
        continue;
      }

      const safety = assessEdits(generated.edits);
      if (!safety.ok) {
        attempts.push({
          attempt,
          strategy: generated.strategy,
          edits: generated.edits,
          applied: false,
          applyReason: `rejected as unsafe: ${safety.reason}`,
          testPassed: false,
          exit: "UNSAFE",
        });
        exit = "UNSAFE";
        reason = `fix rejected as unsafe: ${safety.reason}`;
        break;
      }

      const apply = await deps.sandbox.applyEdits(generated.edits);
      if (!apply.ok) {
        const failure = apply.failed.map((entry) => `${entry.edit.path}: ${entry.reason}`).join("; ");
        const diagnosis = await diagnose(candidate, `Apply failure: ${failure}`, deps.models, deps.logger);
        attempts.push({
          attempt,
          strategy: generated.strategy,
          edits: generated.edits,
          applied: false,
          applyReason: failure,
          diagnosis,
          testPassed: false,
        });
        previousDiagnosis = `The edit could not be applied: ${failure}. ${diagnosis}`;
        continue;
      }

      const verified = await deps.proveCandidate(candidate);
      if (verified.status === "confirmed") {
        attempts.push({
          attempt,
          strategy: generated.strategy,
          edits: generated.edits,
          applied: true,
          testPassed: false,
          testOutput: verified.explanation,
        });
        exit = "UNRESOLVED";
        reason = "the fix did not change the reproduction";
        previousDiagnosis = "The edit applied but the reproduction still fails. The defect is elsewhere; target a different statement.";
        continue;
      }

      if (verified.status === "error" || verified.status === "likely") {
        const diagnosis = await diagnose(candidate, verified.explanation, deps.models, deps.logger);
        attempts.push({
          attempt,
          strategy: generated.strategy,
          edits: generated.edits,
          applied: true,
          testPassed: false,
          testOutput: verified.explanation,
          diagnosis,
        });
        previousDiagnosis = `Reproduction was inconclusive after the edit: ${verified.explanation}. ${diagnosis}`;
        continue;
      }

      attempts.push({
        attempt,
        strategy: generated.strategy,
        edits: generated.edits,
        applied: true,
        testPassed: true,
        testOutput: verified.explanation,
        exit: "VERIFIED",
      });
      exit = "VERIFIED";
      finalEdits = generated.edits;
      finalPatch = unifiedDiffFromEdits(candidate.file, originalContent, generated.edits);
      reason = `fix applied and the reproduction passes after ${attempt} attempt(s)`;
      break;
    }

    if (!exit) {
      exit = "UNRESOLVED";
      reason = `fix not verified within ${deps.maxAttempts} attempt(s)`;
    }

    results.push({
      candidateId: candidate.id,
      severity: candidate.severity,
      exit,
      attempts,
      finalPatch,
      finalEdits,
      durationMs: now() - started,
      toolCalls: attempts.length,
      reason,
    });
  }

  return results;
}
