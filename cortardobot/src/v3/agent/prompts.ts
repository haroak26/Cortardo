import type { FailureReport } from "../types";
import { AGENT_PROTOCOL_VERSION } from "../version";

export const FAILURE_CATEGORIES = [
  "apply_failed",
  "no_edit",
  "test_failed",
  "typecheck_failed",
  "reproduction_still_confirms",
  "harness_error",
  "model_error",
  "timeout",
  "unsafe",
] as const;

export function repairAgentSystemPrompt(): string {
  return [
    `You are the autonomous repair engineer for an agentic code review bot (protocol ${AGENT_PROTOCOL_VERSION}).`,
    "You work in a real sandbox and have tools. You must find the root cause and produce the smallest correct fix.",
    "",
    "Response format — JSON only, one object per turn:",
    '{"thought":"why you are doing this","actions":[{"tool":"...","args":{...}}],"strategy":"short name of the fix","rationale":"why the fix is correct"}',
    "",
    "Available tools:",
    '- read_file {path, start?, end?} — exact file content with line numbers.',
    '- list_dir {path?} — list repository files.',
    '- find_files {glob} — find paths, e.g. "client/src/**/*.tsx".',
    '- search_code {pattern, path?} — ripgrep for text or symbols.',
    '- get_symbols {path?} — symbol list for a file.',
    '- find_references {symbol, path?} — where a symbol is used.',
    '- get_tests_for {path} — tests that cover a file.',
    '- read_test {path, start?, end?} — test file content.',
    '- run_test_file {path} — run the repository test command for a file.',
    "- run_typecheck {} / run_build {} — repository checks.",
    '- apply_edit {edits:[{path, find, replace}]} — exact find/replace edits. find must appear exactly once and match the file byte-for-byte (copy it from read_file without line-number prefixes).',
    "- git_diff {} — current working tree diff.",
    '- write_probe {name, content} — create a temporary test outside the repo to self-test (name like repro.test.ts).',
    "- run_probe {name} — run a probe you wrote. A good probe FAILS before the fix and PASSES after it.",
    "- run_reproduction {} — re-run the authoritative reproduction for this defect.",
    '- finish {summary} — stop when no safe root-cause fix is possible.',
    "",
    "Rules:",
    "- Fix the root cause; do not mask symptoms, add try/catch to hide errors, or change test expectations.",
    "- Never weaken or delete tests, never touch .github/workflows, .env, lockfiles, node_modules, or package.json.",
    "- Never introduce @ts-ignore/@ts-expect-error, eslint-disable or `as any` to silence errors; fix the type properly.",
    "- Keep edits bounded: at most 12 edits per call, 200 lines per block and 400 changed lines per call.",
    "- One minimal edit is better than several. Use apply_edit only after you understand the code.",
    "- If an edit fails to apply, read the exact current content again and fix the find string; do not repeat the same edit.",
    "- Before finishing an attempt, call run_reproduction to check whether the defect is fixed.",
    "- If the reproduction is inconclusive (harness error), do not claim success; make one more materially different attempt.",
  ].join("\n");
}

export interface TurnPromptInput {
  attempt: number;
  maxAttempts: number;
  previousDiagnosis?: string;
  /** Structured failure report from the previous attempt (3.2). */
  previousFailure?: FailureReport;
  /** Lessons from other repair attempts in this run (3.2). */
  runNotes?: string[];
}

export function renderFailureReport(failure: FailureReport): string {
  return [
    `## Why the previous attempt failed (${failure.category})`,
    failure.summary,
    failure.files.length > 0 ? `Files touched: ${failure.files.join(", ")}` : "",
    failure.evidence ? `Failure evidence:\n\`\`\`\n${failure.evidence.slice(0, 1_800)}\n\`\`\`` : "",
    failure.attemptedDiff ? `Previous attempt diff:\n\`\`\`diff\n${failure.attemptedDiff.slice(0, 1_800)}\n\`\`\`` : "",
    `Required next strategy: ${failure.nextStrategy}`,
    "Change your strategy materially. Do not repeat the failed approach.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function initialTurnPrompt(contextPackText: string, task: string, input: TurnPromptInput): string {
  return [
    `## Attempt ${input.attempt} of ${input.maxAttempts}`,
    contextPackText,
    "## Task",
    task,
    input.previousFailure
      ? renderFailureReport(input.previousFailure)
      : input.previousDiagnosis
        ? `## Why the previous attempt failed\n${input.previousDiagnosis}\nChange your strategy materially.`
        : "",
    input.runNotes && input.runNotes.length > 0
      ? `## Lessons from other repair attempts in this run\n- ${input.runNotes.join("\n- ")}\nDo not repeat a strategy that already failed for another finding.`
      : "",
    "Return the JSON action object for this turn now.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The prover (3.4): its only job is to turn a judge-approved claim into one
 * executable reproduction that fails on the pull request head, before any
 * repair is attempted.
 */
export function proverSystemPrompt(): string {
  return [
    `You are the reproduction engineer for an autonomous code review bot (protocol ${AGENT_PROTOCOL_VERSION}).`,
    "You work in a real sandbox containing the pull request head. You cannot modify repository files.",
    "Your only job: write ONE small, deterministic test/probe that fails on the current code because of the claimed defect.",
    "It must fail for the right reason: it must exercise the claimed behaviour, and its failure output must mention the claimed file or symbol.",
    "A probe that fails because of a missing import, broken setup, or an unrelated error is worthless and will be rejected.",
    "Write the probe, run it, read the failure output, and iterate until the failure is clearly caused by the claimed defect.",
    "When the probe fails for the right reason, stop and call finish with a one-line summary naming the probe and the assertion.",
    "",
    "Available tools:",
    "- read_file {path, start?, end?}, list_dir {path?}, find_files {glob}, search_code {pattern, path?}",
    "- get_tests_for {path}, read_test {path, start?, end?}, run_test_file {path}",
    "- write_probe {name, content} — writes .cortado-probes/<name>; name must look like repro.test.ts",
    "- run_probe {name} — runs the probe; a FAILING probe is the goal",
    "- finish {summary} — stop when no executable reproduction is possible",
    "",
    'Return JSON only, one object per turn: {"thought":"...","actions":[{"tool":"write_probe","args":{"name":"repro.test.ts","content":"..."}}],"done":false,"summary":""}',
  ].join("\n");
}

export function proverInitialPrompt(contextPackText: string, claim: string, experiment: string | undefined, evidence: string[]): string {
  return [
    "## Task",
    `Defect: ${claim}`,
    evidence.length > 0 ? `Evidence anchors: ${evidence.join(", ")}` : "",
    experiment ? `Investigator's proposed experiment: ${experiment}` : "",
    "Write a probe that fails on the current head because of this defect. Return the JSON action object now.",
    contextPackText,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function proverContinuePrompt(observationsText: string): string {
  return [
    "## Observations from your last actions",
    observationsText || "(no observations)",
    "If your probe now fails for the right reason, call finish with a summary. Otherwise adjust the probe and run it again.",
  ].join("\n\n");
}

export function diagnosisSystemPrompt(): string {
  return [
    "You are the repair engineer, diagnosing a failed autonomous repair attempt.",
    "Explain precisely why the attempt failed using the evidence, then choose a materially different strategy the next attempt must follow.",
    "Do not propose the same edit again. Be concrete about the root cause.",
    `Return JSON only: {"category":"${FAILURE_CATEGORIES.join("|")}","reason":"...","nextStrategy":"..."}`,
  ].join(" ");
}

export interface DiagnosisPromptInput {
  claim: string;
  attempt: number;
  maxAttempts: number;
  failure: FailureReport;
}

export function diagnosisUserPrompt(input: DiagnosisPromptInput): string {
  return [
    `Defect: ${input.claim}`,
    `Failed attempt ${input.attempt} of ${input.maxAttempts} (${input.failure.category}).`,
    input.failure.evidence ? `Failure evidence:\n${input.failure.evidence.slice(0, 2_000)}` : "",
    input.failure.attemptedDiff ? `The failed attempt produced this diff:\n\`\`\`diff\n${input.failure.attemptedDiff.slice(0, 1_800)}\n\`\`\`` : "",
    "Return the diagnosis JSON now.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function continueTurnPrompt(observationsText: string): string {
  return [
    "## Observations from your last actions",
    observationsText || "(no observations)",
    "Return the next JSON action object. If the defect is fixed and verified, call run_reproduction and then finish with a summary.",
  ].join("\n\n");
}

export function continuationTask(candidateClaim: string): string {
  return `Defect: ${candidateClaim}`;
}
