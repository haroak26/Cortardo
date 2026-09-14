import type {
  AgentSpec,
  MergedCandidate,
  PRContext,
  PullRequestInput,
  RepairResult,
  VerificationReport,
} from "../types";
import { truncate } from "../util/text";

const COMPACT_RULES = [
  "Return JSON only, matching the requested schema exactly.",
  "Never invent file paths or line numbers that are not present in the provided evidence.",
  "Prefer one strong hypothesis over many weak ones.",
  "No essays, no generic advice, no style commentary.",
].join(" ");

export function swarmSystemPrompt(agent: AgentSpec): string {
  return [
    `You are ${agent.title}, one investigator in an autonomous code review swarm.`,
    `Focus: ${agent.focus}.`,
    "Inspect only the provided diff and context.",
    "Return at most 2 hypotheses as {\"hypotheses\":[{claim,evidence,severity,confidence,suggestedExperiment}]}.",
    "evidence entries must be file:line strings taken from the provided diff.",
    "Output a single JSON object and nothing else: no analysis, no markdown, no prose.",
    "confidence must be a JSON number between 0 and 1. claim at most 300 characters, suggestedExperiment at most 200 characters.",
    COMPACT_RULES,
  ].join(" ");
}

export function swarmUserPrompt(
  agent: AgentSpec,
  context: PRContext,
  files: Array<{ path: string; patch: string }>,
  input: PullRequestInput,
): string {
  const excerpts = files
    .slice(0, 6)
    .map((file) => `### ${file.path}\n${truncate(file.patch, 4000)}`)
    .join("\n\n");
  return [
    `PR: ${input.title}`,
    input.body ? `Description: ${truncate(input.body, 800)}` : "",
    `Classifications: ${context.classification.join(", ")} | Size: ${context.size}`,
    context.repoRules.length > 0 ? `Repo rules:\n- ${context.repoRules.slice(0, 8).join("\n- ")}` : "",
    `Diff excerpts:\n${excerpts}`,
    `Respond with JSON only for agent ${agent.id}.`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function judgeSystemPrompt(): string {
  return [
    "You are Terra, the synthesis judge in an autonomous code review pipeline.",
    "Decide which candidate hypotheses deserve execution-based proof.",
    "PROVE only claims that materially affect correctness, security, data, or API contracts, and that an experiment can settle quickly.",
    "STATIC_ONLY for real but low-value or unprovable claims. DISCARD for noise.",
    "For every PROVE decision, provide reproductionCommand: one short, non-destructive shell command that settles the claim.",
    "The command must print CORTADO_VULNERABLE and exit non-zero when the defect is present, and print CORTADO_SAFE and exit zero when it is not.",
    "Prefer the repository's existing test runner for the affected file; only fall back to a node/python probe when no test covers it.",
    "Keep reason under 200 characters, priority a JSON number from 1 to 10, reproductionCommand under 300 characters.",
    "Return JSON only: {\"decisions\":[{hypothesisId,verdict,reason,priority,reproductionCommand}]}. Every candidate id must appear exactly once.",
  ].join(" ");
}

export function judgeUserPrompt(candidates: MergedCandidate[], context: PRContext): string {
  const list = candidates
    .map(
      (candidate) =>
        `- id=${candidate.id} severity=${candidate.severity} confidence=${candidate.confidence.toFixed(2)} file=${
          candidate.file ?? "n/a"
        } occurrences=${candidate.occurrences} claim=${truncate(candidate.claim, 220)} evidence=${candidate.evidence.join(",")}`,
    )
    .join("\n");
  return [`PR: ${context.title}`, `Candidates:\n${list}`, "Return the JSON decision now."].join("\n\n");
}

export function repairPlanSystemPrompt(): string {
  return [
    "You are Terra, the autonomous repair planner.",
    "Design the smallest safe patch that removes the root cause without weakening tests or changing unrelated behavior.",
    "Return JSON only: {strategy, files, rationale}. strategy under 200 characters, rationale under 400 characters.",
  ].join(" ");
}

export function repairPlanUserPrompt(
  candidate: MergedCandidate,
  reproduction: string,
  fileContents: Record<string, string>,
  attempt: number,
  previousDiagnosis?: string,
): string {
  const files = Object.entries(fileContents)
    .slice(0, 4)
    .map(([path, content]) => `### ${path}\n${truncate(content, 3000)}`)
    .join("\n\n");
  return [
    `Finding: ${candidate.claim}`,
    `Severity: ${candidate.severity} | Confidence: ${candidate.confidence}`,
    `Evidence: ${candidate.evidence.join(", ")}`,
    `Reproduction: ${truncate(reproduction, 600)}`,
    previousDiagnosis ? `Previous failure: ${previousDiagnosis}` : "",
    `Attempt: ${attempt}`,
    `Relevant code:\n${files}`,
    "Return the repair plan JSON now.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function repairPatchSystemPrompt(): string {
  return [
    "You are Terra, the autonomous repair engineer.",
    "Produce a unified diff patch (--- a/path, +++ b/path, @@ hunks) that fixes the finding.",
    "Change only the files provided. Never delete or weaken tests.",
    "Return JSON only: {patch, description}.",
  ].join(" ");
}

export function repairPatchUserPrompt(
  candidate: MergedCandidate,
  strategy: string,
  fileContents: Record<string, string>,
  attempt: number,
): string {
  const files = Object.entries(fileContents)
    .slice(0, 4)
    .map(([path, content]) => `### ${path}\n${truncate(content, 3000)}`)
    .join("\n\n");
  return [
    `Finding: ${candidate.claim}`,
    `Strategy: ${strategy}`,
    `Attempt: ${attempt}`,
    `Files:\n${files}`,
    'Return JSON: {"patch":"<unified diff>","description":"<one line>"}.',
  ].join("\n\n");
}

export function diagnosisSystemPrompt(): string {
  return [
    "You are Terra, diagnosing a failed repair attempt.",
    "Explain precisely why the patch failed using the test output, then choose a materially different strategy.",
    "Return JSON only: {reason, nextStrategy}. reason under 300 characters, nextStrategy under 200 characters.",
  ].join(" ");
}

export function diagnosisUserPrompt(
  candidate: MergedCandidate,
  attempt: number,
  testOutput: string,
): string {
  return [
    `Finding: ${candidate.claim}`,
    `Failed attempt: ${attempt}`,
    `Test output:\n${truncate(testOutput, 2000)}`,
    "Return the diagnosis JSON now.",
  ].join("\n\n");
}

export function finalReviewSystemPrompt(): string {
  return [
    "You are Astra, the final independent reviewer.",
    "Judge the validity of each finding and the correctness of the final patch using only the provided evidence.",
    "Be skeptical: if verification is missing or weak, lower confidence and request changes.",
    "Use the exact candidateId values provided. confidence is a JSON number between 0 and 1, summary under 400 characters.",
    "Return JSON only: {\"reviews\":[{candidateId,validity,fixCorrectness,risk,approval,confidence,summary}]}.",
  ].join(" ");
}

export function finalReviewUserPrompt(
  items: Array<{
    candidate: MergedCandidate;
    proofStatus: string;
    repair?: RepairResult;
    verification?: VerificationReport;
    diff: string;
  }>,
): string {
  const blocks = items
    .map((item) => {
      const attempts = item.repair?.attempts.map((attempt) => attempt.strategy).join(" -> ") ?? "none";
      return [
        `## Finding ${item.candidate.id}`,
        `Claim: ${item.candidate.claim}`,
        `Severity: ${item.candidate.severity}`,
        `Evidence: ${item.candidate.evidence.join(", ")}`,
        `Proof: ${item.proofStatus}`,
        `Repair: ${item.repair?.exit ?? "not attempted"} (${attempts})`,
        `Verification: ${item.verification ? (item.verification.passed ? "passed" : "failed") : "none"}`,
        item.diff ? `Patch:\n${truncate(item.diff, 1500)}` : "Patch: none",
      ].join("\n");
    })
    .join("\n\n");
  return [`Findings:\n${blocks}`, "Return the review JSON now."].join("\n\n");
}
