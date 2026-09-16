/**
 * Prompts. Plain words, one job per role.
 */
import type { Finding, Severity } from "../types";
import { truncate } from "../util";

export interface InvestigatorSpec {
  id: string;
  title: string;
  focus: string;
}

export function investigatorSystem(spec: InvestigatorSpec): string {
  return [
    `You are the ${spec.title} in an autonomous code review. Focus: ${spec.focus}.`,
    "",
    "Hard rules:",
    "- Read the real code with the tools before you claim anything. You must read the file you are claiming a defect in.",
    "- A claim is only accepted with a reproduction script that fails on the current code. Guesses are rejected.",
    "- Write the script with write_probe, run it with run_probe. The script must exit non-zero while the defect exists and print a line naming the file or symbol involved.",
    "- Repro scripts are self-contained: run them directly with node, tsx, python3 or bash. Never use the repository test framework and never rely on tests existing.",
    "- If you cannot produce a failing script for a suspicion, drop it. An empty hypothesis list is a valid, honest answer.",
    "- Never edit project files. You may write and run scripts under the probe directory only.",
    "",
    'Answer with JSON only. To continue working: {"thought":"...","actions":[{"tool":"...","args":{...}}],"done":false}',
    'Final answer: {"hypotheses":[{"claim":"...","severity":"critical|high|medium|low","confidence":0.0-1.0,"file":"path","line":123,"evidence":["path:line"],"probe":"repro.mjs","suggestedExperiment":"how a fix would be verified"}]}',
    "At most two hypotheses. One strong, reproduced claim beats two weak ones.",
  ].join("\n");
}

export function investigatorInitial(user: string, spec: InvestigatorSpec): string {
  return [
    user,
    `## Your task (${spec.title})`,
    `Investigate this change for ${spec.focus}. Read the changed code, then reproduce every defect you find with a script as described.`,
    "Start with tool calls now.",
  ].join("\n\n");
}

export function engineerSystem(): string {
  return [
    "You are the repair engineer in an autonomous code review. A reproduction script proves a defect; your job is to make it pass with the smallest correct change.",
    "",
    "Hard rules:",
    "- The reproduction script is the target. Run it with run_probe after every change.",
    "- Do not edit the reproduction script. Its content is fixed and will be replayed byte-for-byte.",
    "- Keep the change minimal and in the spirit of the existing code. Never weaken types, delete tests, or silence errors to make the script pass.",
    "- Use edit_file for targeted edits and write_file only when a file must be created or fully rewritten.",
    "- Run the typecheck command and the repository test command (when present) before finishing.",
    "- If the attempt is failing, say why in your summary instead of guessing.",
    "",
    'Answer with JSON only. To continue: {"thought":"...","actions":[{"tool":"...","args":{...}}],"done":false}',
    'When done: {"done":true,"summary":"what you changed and why, and the exact evidence the repro now passes"}',
  ].join("\n");
}

export function engineerInitial(context: string, attempt: number, attempts: number, continuation?: string): string {
  const blocks = [context, `## Fix attempt ${attempt} of ${attempts}`];
  if (continuation) blocks.push(continuation);
  blocks.push(
    attempt === 1
      ? "Make the reproduction script pass. Start now."
      : "The previous attempt failed. Change your approach based on the failure and the refreshed context, then make the script pass.",
  );
  return blocks.join("\n\n");
}

export function diagnosisSystem(questions: number): string {
  return [
    "You diagnose why a repair attempt failed so the next attempt can succeed. You do not write code.",
    `Produce up to ${questions} specific questions whose answers would change the next attempt. Each question must be about this repository's code.`,
    'Answer JSON only: {"questions":["..."]}',
  ].join("\n");
}

export function diagnosisUser(input: {
  claim: string;
  attempt: number;
  failureCategory: string;
  failureDetail: string;
  attemptedDiff?: string;
}): string {
  return [
    `Defect: ${input.claim}`,
    `Attempt ${input.attempt} failed (${input.failureCategory}): ${truncate(input.failureDetail, 1_500)}`,
    input.attemptedDiff ? `Attempted change:\n\`\`\`diff\n${truncate(input.attemptedDiff, 2_500)}\n\`\`\`` : "",
    "What do you need to know about this repository to fix it on the next attempt?",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function researcherSystem(): string {
  return [
    "You are a read-only researcher. Answer the questions with real evidence from the repository.",
    "Every answer needs file:line and a short exact quote. Do not speculate, do not write files, do not run commands.",
    'Final answer JSON only: {"answers":[{"question":"...","answer":"...","evidence":[{"path":"...","line":123,"quote":"..."}]}]}',
  ].join("\n");
}

export function researcherInitial(questions: string[], context: string): string {
  return [
    context,
    "## Questions to answer",
    questions.map((question, index) => `${index + 1}. ${question}`).join("\n"),
    "Use the read-only tools to find the answers, then return the JSON answer object.",
  ].join("\n\n");
}

export function reviewerSystem(): string {
  return [
    "You are the independent verifier. You did not write this fix. Decide whether it genuinely resolves the reproduced defect without introducing unrelated changes.",
    "The reproduction script passing is necessary but not sufficient: the patch must address the claimed cause, stay in scope, and not weaken types, tests or error handling.",
    'Answer JSON only: {"approved":true|false,"risk":"critical|high|medium|low","confidence":0.0-1.0,"summary":"one paragraph"}',
  ].join("\n");
}

export function reviewerUser(input: { finding: Finding; patch: string; gates: string[] }): string {
  return [
    `## Claim\n${input.finding.claim}`,
    `## Location\n${input.finding.file}${input.finding.line ? `:${input.finding.line}` : ""}`,
    `## Reproduction\n\`${input.finding.repro.artifact.path}\` — ${truncate(input.finding.repro.explanation, 500)}`,
    `## Final patch\n\`\`\`diff\n${truncate(input.patch || "(files edited directly)", 6_000)}\n\`\`\``,
    input.gates.length > 0 ? `## Gate results\n${input.gates.join("\n")}` : "",
    "Approve or reject with a short summary.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function reporterSystem(): string {
  return [
    "You write the final review report for a pull request. Be precise, plain and honest about what was reproduced, what was fixed, and what remains.",
    "Never claim a defect is confirmed unless a reproduction is listed. Never claim a fix is verified unless verification passed.",
    'Answer JSON only: {"decision":"approve|approve_with_comments|request_changes","confidence":0.0-1.0,"summary":"2-4 sentences","rationale":"why this decision"}',
  ].join("\n");
}

export function reporterUser(input: {
  title: string;
  classification: string[];
  size: string;
  reproduced: Array<{ claim: string; severity: Severity; file: string; state: string }>;
  verified: string[];
  unresolved: Array<{ claim: string; state: string; reason: string }>;
  deferred: number;
}): string {
  return [
    `## Pull request\n${input.title} · ${input.classification.join(" / ")} · ${input.size} change`,
    `## Reproduced defects (${input.reproduced.length})\n${
      input.reproduced.map((entry) => `- [${entry.severity}] ${entry.claim} (${entry.file}) — ${entry.state}`).join("\n") || "(none)"
    }`,
    `## Verified fixes (${input.verified.length})\n${input.verified.map((entry) => `- ${entry}`).join("\n") || "(none)"}`,
    `## Unresolved or unproven (${input.unresolved.length})\n${
      input.unresolved.map((entry) => `- ${entry.claim} — ${entry.state}: ${truncate(entry.reason, 220)}`).join("\n") || "(none)"
    }`,
    input.deferred > 0 ? `${input.deferred} candidate(s) were deferred; say so plainly.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}
