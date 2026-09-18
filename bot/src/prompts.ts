/**
 * Prompts for the two-stage agent design: the coordinator plans assignments and
 * synthesizes the final hypotheses; swarm investigators read the real code and
 * gather evidence inside one assignment.
 */
import type { FixEdit, FixPlan, Hypothesis, SwarmAssignment, SwarmAgentReport, VerifyPlan } from "./types.ts";
import { renderDismissals } from "./learnings.ts";
import type { HypothesisDismissal } from "./types.ts";

const MECHANISM_LIST =
  "resource-leak, crash, race, wrong-value, contract-break, swallowed-error, state-corruption, stale-state";

function renderLeads(leads: Hypothesis[], max = 24): string {
  if (leads.length === 0) return "(none — derive suspicions from the diff and the graph yourself)";
  return leads
    .slice(0, max)
    .map((lead) => {
      const downstream =
        lead.downstream.length > 0
          ? ` → ${lead.downstream.map((ref) => `${ref.file}${ref.symbol ? `#${ref.symbol}` : ""} (${ref.relation})`).join(", ")}`
          : "";
      return `- [${lead.severity}/${lead.confidence.toFixed(2)}] ${lead.file}:${lead.line} ${lead.mechanism} — ${lead.change} (leadId ${lead.id})${downstream}\n  why: ${lead.why}`;
    })
    .join("\n");
}

// ---------------------------------------------------------------------------
// Coordinator — one cacheable system prompt, two task modes
// ---------------------------------------------------------------------------

/**
 * Identical for the plan and synthesis calls, so the provider can serve the
 * shared system + PR header + diff prefix from its prompt cache.
 */
export function coordinatorSystem(): string {
  return [
    "You are the coordinator of a code-review investigation. You do not investigate yourself: you split a pull request diff plus its deterministic leads into focused assignments for read-only investigators, then you merge their reports into the final ranked hypotheses.",
    "",
    "Hard rules:",
    "- Cite only files in the diff, and only added lines for line numbers.",
    "- Keep every hypothesis that has real evidence; drop duplicates and unsupported claims.",
    "- One bug must appear exactly once, even if the wording, the mechanism name or the cited line differs. Merge duplicates into the strongest entry. Only split when the failure paths are genuinely different and each has its own evidence.",
    `- Use the mechanism vocabulary: ${MECHANISM_LIST}.`,
    "- Behavior only; no style or naming.",
    "- The task section at the end decides your mode (PLAN or SYNTHESIZE) and gives the output schema.",
    "",
    "Answer with JSON only, exactly the schema the task section shows.",
  ].join("\n");
}

export interface CoordinatorPlanInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  body?: string;
  headSha: string;
  diff: string;
  graph: string;
  leads: Hypothesis[];
  dismissals: HypothesisDismissal[];
  maxAgents: number;
}

export function coordinatorPlanUser(input: CoordinatorPlanInput): string {
  const blocks: string[] = [];
  blocks.push(
    `## Pull request #${input.pullRequestNumber} — ${input.title || "(no title)"}\n` +
      `Repository: ${input.repository} · head ${input.headSha.slice(0, 8)}`,
  );
  blocks.push(`### Diff (added lines marked ">")\n${input.diff || "(no textual diff available)"}`);
  if (input.body?.trim()) blocks.push(`### PR description\n${input.body.trim().slice(0, 1_500)}`);
  blocks.push(`### Code graph evidence\n${input.graph || "(no indexed graph available)"}`);
  blocks.push(`### Deterministic leads\n${renderLeads(input.leads)}`);
  const learnings = renderDismissals(input.dismissals);
  if (learnings) blocks.push(learnings);
  blocks.push(
    "### Task: PLAN\n" +
      `Create at most ${input.maxAgents} assignments for read-only investigators. ` +
      "A `lead` assignment names one or more deterministic lead ids and the file(s) they live in; its focus says exactly what the investigator must check. " +
      "A `sweep` assignment covers a changed file group that has no lead, focusing on behavior that only shows when the code runs. " +
      "Every assignment must cite files from the diff and, for lead assignments, real lead ids. " +
      "Prefer a few deep assignments over many shallow ones, and cluster work by causal mechanism (a lead plus the callers/callees it touches) rather than one file per agent. " +
      "Assign the leads above, then cover the changed files that have no lead. " +
      'Answer with JSON only: {"assignments":[{"id":"a1","kind":"lead|sweep","files":["path"],"leads":["s_abc123"],"focus":"what to verify and why"}]}',
  );
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Swarm — investigator
// ---------------------------------------------------------------------------

export function swarmSystem(): string {
  return [
    "You are a hypothesis investigator in a code review. You run read-only tools over the repository and the diff, and you report only what the evidence supports.",
    "",
    "Method:",
    "1. Read the changed lines with read_diff, then follow them outward with read_file and get_impact before claiming anything.",
    "2. Treat every behavior-changing line as suspicious by default: changed conditions and ternaries, defaults, literals, hardcoded values, storage/query keys, cache invalidation targets, error handling, awaited calls.",
    "3. For each real defect, state the exact added line, the mechanism, the concrete failure path, and the one question that decides it.",
    "4. Before answering, you must have read the changed code. Your final answer lists every file:line you actually read in `checked`.",
    "",
    "Hard rules:",
    `- Mechanism must be one of: ${MECHANISM_LIST}.`,
    "- Cite only files in the diff and only added lines for line numbers.",
    "- If the assignment's suspicion does not survive reading the code, return an empty hypothesis list but still report what you read in `checked`.",
    "- Never invent a defect to fill space, and never return an empty `checked` list.",
    "- No style, naming or formatting notes. Behavior only.",
    "",
    'Answer with JSON only. To use tools: {"thought":"...","actions":[{"tool":"read_file","args":{"path":"..."}}],"done":false}',
    "Allowed tools: read_file, find_files, search_code, get_impact, read_diff.",
    'Final answer: {"checked":["path:42"],"hypotheses":[{"file":"path","line":42,"snippet":"the added line","mechanism":"resource-leak","severity":"critical|high|medium|low","confidence":0.0-1.0,"change":"what changed","why":"the concrete failure path","question":"the one question that decides it","downstream":[{"file":"path","symbol":"name","relation":"calls|imports"}]}]}',
    "At most two hypotheses. One evidence-backed claim beats two weak ones.",
  ].join("\n");
}

export interface SwarmAssignmentInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  assignment: SwarmAssignment;
  fileDiffs: string;
  graphEvidence: string;
  leads: Hypothesis[];
  dismissals: HypothesisDismissal[];
}

export function swarmUser(input: SwarmAssignmentInput): string {
  const blocks: string[] = [];
  blocks.push(
    `## Pull request #${input.pullRequestNumber} — ${input.title || "(no title)"}\n` +
      `Repository: ${input.repository} · head ${input.headSha.slice(0, 8)}`,
  );
  blocks.push(`### Your assignment (${input.assignment.kind})\n${input.assignment.focus}`);
  blocks.push(`Files in scope: ${input.assignment.files.map((file) => `\`${file}\``).join(", ")}`);
  blocks.push(`### Diff for the files in scope (added lines marked ">")\n${input.fileDiffs || "(no textual diff available)"}`);
  if (input.graphEvidence) blocks.push(`### Graph evidence\n${input.graphEvidence}`);
  if (input.leads.length > 0) blocks.push(`### Leads assigned to you\n${renderLeads(input.leads, 8)}`);
  const learnings = renderDismissals(input.dismissals);
  if (learnings) blocks.push(learnings);
  blocks.push(
    "Read the code, verify or kill the suspicion, then return your final JSON. Start with a tool call now.",
  );
  return blocks.join("\n\n");
}

/**
 * Identical to the plan system so the two coordinator calls share one cached
 * prefix; the mode differences live in the task section after the diff.
 */
export function coordinatorSynthesizeSystem(): string {
  return coordinatorSystem();
}

function renderSwarmReport(report: SwarmAgentReport): string {
  if (report.failure) return `### ${report.assignmentId} — FAILED: ${report.failure}`;
  const checked = report.checked.length > 0 ? `\nchecked: ${report.checked.join(", ")}` : "\nchecked: (nothing — treat as unverified)";
  if (report.hypotheses.length === 0) {
    return `### ${report.assignmentId} — no supported defects (${report.toolCalls} tool call(s), ${report.stoppedReason})${checked}`;
  }
  return [
    `### ${report.assignmentId} — ${report.hypotheses.length} finding(s) (${report.toolCalls} tool call(s))${checked}`,
    ...report.hypotheses.map(
      (hypothesis) =>
        `- [${hypothesis.severity}/${hypothesis.confidence.toFixed(2)}] ${hypothesis.file}:${hypothesis.line} ${hypothesis.mechanism} — ${hypothesis.change} (id ${hypothesis.id})\n  why: ${hypothesis.why}\n  question: ${hypothesis.question}`,
    ),
  ].join("\n");
}

export interface CoordinatorSynthesizeInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  diff: string;
  leads: Hypothesis[];
  reports: SwarmAgentReport[];
  dismissals: HypothesisDismissal[];
  maxHypotheses: number;
}

export function coordinatorSynthesizeUser(input: CoordinatorSynthesizeInput): string {
  const blocks: string[] = [];
  blocks.push(
    `## Pull request #${input.pullRequestNumber} — ${input.title || "(no title)"}\n` +
      `Repository: ${input.repository} · head ${input.headSha.slice(0, 8)}`,
  );
  blocks.push(`### Diff (added lines marked ">")\n${input.diff || "(no textual diff available)"}`);
  blocks.push(`### Deterministic leads\n${renderLeads(input.leads)}`);
  blocks.push(`### Investigator reports\n${input.reports.map(renderSwarmReport).join("\n\n") || "(none — the swarm did not run)"}`);
  const learnings = renderDismissals(input.dismissals);
  if (learnings) blocks.push(learnings);
  blocks.push(
    "### Task: SYNTHESIZE\n" +
      `Merge the investigators' reports and the leads into the final ranked hypotheses, at most ${input.maxHypotheses}, strongest first; fewer is fine. ` +
      "A lead that investigators confirmed should keep its leadId. " +
      "Investigators can miss defects; if a behavior-changing line in the diff has no investigator finding, add it yourself. " +
      'Answer with JSON only: {"hypotheses":[{"file":"path","line":42,"snippet":"the added line","mechanism":"resource-leak","severity":"critical|high|medium|low","confidence":0.0-1.0,"priority":1,"change":"what changed","why":"the concrete failure path","question":"the one question that decides it","downstream":[{"file":"path","symbol":"name","relation":"calls|imports"}],"leadId":"optional lead id"}]}',
  );
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Stage 3 — fix planning (coordinator) and codegen (engineer)
// ---------------------------------------------------------------------------

function renderHypothesesForPlanning(hypotheses: Hypothesis[]): string {
  return hypotheses
    .map(
      (hypothesis) =>
        `- #${hypothesis.priority ?? "-"} [${hypothesis.severity}/${hypothesis.confidence.toFixed(2)}] ${hypothesis.file}:${hypothesis.line} ${hypothesis.mechanism} — ${hypothesis.change} (id ${hypothesis.id})\n` +
        `  why: ${hypothesis.why}\n  question: ${hypothesis.question}`,
    )
    .join("\n");
}

export function coordinatorFixPlanSystem(maxFixes: number): string {
  const cap = maxFixes > 0 ? ` at most ${maxFixes}` : "";
  return [
    "You are the coordinator of a code-review investigation. The team has listed the suspicious changes; you now produce one fix plan per hypothesis so an engineer can write the patch.",
    "",
    "Plan rules:",
    `- Produce${cap} plans, one per hypothesis, in priority order.`,
    "- Be concrete: name the files to change, the exact code-level steps, and the risk of the change.",
    "- The engineer writes exact find/replace edits on existing files: never plan to create a new file, and never plan a rewrite of a file. If the correct fix needs a new file, fold the logic into the existing changed file instead.",
    "- Plan the smallest correct fix. Never plan a rewrite, a refactor or an unrelated cleanup.",
    "- If a hypothesis cannot be fixed without more information, plan it as not fixable and say what is missing.",
    "- You may plan edits outside the diff when the change requires updating a caller or type.",
    "- No tests need to be written; write the testIdea that would prove the fix.",
    "",
    "Answer with JSON only:",
    '{"fixes":[{"hypothesisId":"s_abc","summary":"what the fix does","steps":["..."],"files":["path"],"risks":"what could break","testIdea":"how to prove it"}],"notFixable":[{"hypothesisId":"s_def","reason":"what is missing"}]}',
  ].join("\n");
}

export interface CoordinatorFixPlanInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  diff: string;
  hypotheses: Hypothesis[];
  maxFixes: number;
}

export function coordinatorFixPlanUser(input: CoordinatorFixPlanInput): string {
  return [
    `## Pull request #${input.pullRequestNumber} — ${input.title || "(no title)"}\nRepository: ${input.repository} · head ${input.headSha.slice(0, 8)}`,
    `### Diff (added lines marked ">")\n${input.diff || "(no textual diff available)"}`,
    `### Hypotheses to fix\n${renderHypothesesForPlanning(input.hypotheses)}`,
    input.maxFixes > 0 ? `Plan at most ${input.maxFixes} fixes, highest priority first.` : "Plan a fix for every hypothesis you can.",
    "Return the JSON object now.",
  ].join("\n\n");
}

export function codegenSystem(sharedContext?: string): string {
  const blocks = [
    "You are the codegen engineer in a code review. You receive one hypothesis and a fix plan; you write the exact code change.",
    "",
    "Method:",
    "1. Read the current code around the change with read_file, read_diff and get_impact. The fix must match the file exactly as it is now.",
    "2. Write the smallest correct change. Follow the surrounding style. Never weaken types, delete validation or silence errors.",
    "3. Return edits as exact find/replace pairs: `find` is existing text that appears exactly once in the file, `replace` is the new text.",
    "",
    "Hard rules:",
    "- Never invent a file or a function. If the plan names a file, read it first.",
    "- One edit per contiguous change; keep each `find` short but unique.",
    "- If you are not confident the fix is correct, refuse instead of guessing: {\"refused\":true,\"reason\":\"...\"}.",
    "- No style-only edits and no unrelated changes.",
    "",
    'Answer with JSON only. To use tools: {"thought":"...","actions":[{"tool":"read_file","args":{"path":"..."}}],"done":false}',
    "Allowed tools: read_file, find_files, search_code, get_impact, read_diff.",
    'Final answer: {"edits":[{"path":"src/file.ts","find":"exact current text","replace":"new text"}],"summary":"what the fix does","confidence":0.0-1.0}',
  ];
  if (sharedContext) {
    blocks.push(
      "",
      "## Repository context (shared by every fix in this run)",
      sharedContext,
      "Use it for orientation only; the exact current text must come from read_file/read_diff.",
    );
  }
  return blocks.join("\n");
}

export interface CodegenInput {
  repository: string;
  pullRequestNumber: number;
  title: string;
  headSha: string;
  hypothesis: Hypothesis;
  plan: FixPlan;
  fileDiffs?: string;
  outsideDiffNote?: string;
  failureContext?: string;
}

export function codegenUser(input: CodegenInput): string {
  const blocks: string[] = [];
  blocks.push(
    `## Pull request #${input.pullRequestNumber} — ${input.title || "(no title)"}\n` +
      `Repository: ${input.repository} · head ${input.headSha.slice(0, 8)}`,
  );
  blocks.push(
    `### Hypothesis (id ${input.hypothesis.id}, priority #${input.hypothesis.priority ?? "-"})\n` +
      `${input.hypothesis.file}:${input.hypothesis.line} · ${input.hypothesis.mechanism} · ${input.hypothesis.severity}\n` +
      `${input.hypothesis.change}\nwhy: ${input.hypothesis.why}\ndeciding question: ${input.hypothesis.question}`,
  );
  blocks.push(
    `### Fix plan\n${input.plan.summary}\n` +
      input.plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n") +
      (input.plan.risks ? `\nrisks: ${input.plan.risks}` : "") +
      (input.plan.testIdea ? `\ntest idea: ${input.plan.testIdea}` : ""),
  );
  if (input.fileDiffs) blocks.push(`### Diff for the files in scope (added lines marked ">")\n${input.fileDiffs}`);
  if (input.outsideDiffNote) blocks.push(`### Note\n${input.outsideDiffNote}`);
  if (input.failureContext) blocks.push(`### Sandbox failure context\n${input.failureContext}`);
  blocks.push("Read the current code, then return the final JSON with your exact edits. Start with a tool call now.");
  return blocks.join("\n\n");
}

// ---------------------------------------------------------------------------
// Stage 4 — sandbox verification (terra plans, terra diagnoses)
// ---------------------------------------------------------------------------

function renderEditsForPrompt(edits: FixEdit[], maxChars = 4_000): string {
  if (edits.length === 0) return "(no edits)";
  return edits
    .map(
      (edit, index) =>
        `#### edit ${index + 1}: ${edit.path}${edit.outsideDiff ? " (outside the PR diff)" : ""}\n` +
        `find:\n\`\`\`\n${edit.find}\n\`\`\`\nreplace:\n\`\`\`\n${edit.replace}\n\`\`\``,
    )
    .join("\n\n")
    .slice(0, maxChars);
}

export function verifyPlanSystem(maxCommands: number, commandTimeoutMs: number): string {
  return [
    "You are the verification planner of a code-review pipeline. A fix has been drafted for one hypothesis. You design the cheapest harness that proves the fix works in a fresh sandbox clone of the repository at the PR head.",
    "",
    "Rules:",
    "- Prefer the repository's own test, typecheck and build commands, and existing test files. Always include the repository's typecheck or test command: it is what catches knock-on effects in imports, callers and bundling.",
    `- At most ${maxCommands} commands; each runs from the repository root with a timeout up to ${commandTimeoutMs} ms and must exit 0 to pass.`,
    "- If no existing test covers the changed code, write small probe files (test or script) that exercise the exact changed behavior, and include the command that runs them.",
    "- A probe must execute the changed code: import the changed module and call the changed path, or run it through the repository's test runner. A probe that only reads source text (readFileSync plus includes/match/regex) is static evidence — it is published as 'behavior not exercised' and never counts as behavioral proof.",
    "- Probe files land inside the repository; paths must be relative and may not escape it.",
    "- Put a command in `mustFailBefore` only when you are confident it fails on the unfixed head (a reproduction). Otherwise leave it out.",
    "- Never push, never install globally, never delete the repository or use destructive shell commands.",
    "- Install runs once before the commands; propose an `install` command only when the repository does not use its lockfile default.",
    "- If nothing in the repository can prove this fix, return an empty command list and say so in `notes`.",
    "",
    "Answer with JSON only:",
    '{"install":"npm ci","probeFiles":[{"path":"probe/verify.test.ts","content":"..."}],"commands":[{"cmd":"npm run check","why":"typecheck the changed code","timeoutMs":180000}],"mustFailBefore":[],"notes":"..."}',
  ].join("\n");
}

export interface VerifyPlanInput {
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
}

export function verifyPlanUser(input: VerifyPlanInput): string {
  const blocks: string[] = [];
  blocks.push(
    `## Pull request #${input.pullRequestNumber} — ${input.title || "(no title)"}\n` +
      `Repository: ${input.repository} · head ${input.headSha.slice(0, 8)}`,
  );
  blocks.push(
    `### Hypothesis (id ${input.hypothesis.id}, priority #${input.hypothesis.priority ?? "-"})\n` +
      `${input.hypothesis.file}:${input.hypothesis.line} · ${input.hypothesis.mechanism} · ${input.hypothesis.severity}\n` +
      `${input.hypothesis.change}\nwhy: ${input.hypothesis.why}\ndeciding question: ${input.hypothesis.question}`,
  );
  blocks.push(
    `### Fix plan\n${input.plan.summary}\n` +
      input.plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n") +
      (input.plan.testIdea ? `\ntest idea: ${input.plan.testIdea}` : ""),
  );
  blocks.push(`### Drafted edits\n${renderEditsForPrompt(input.edits)}`);
  if (input.fileDiffs) blocks.push(`### Diff for the changed files (added lines marked ">")\n${input.fileDiffs}`);
  if (input.packageJson) blocks.push(`### package.json\n\`\`\`json\n${input.packageJson.slice(0, 4_000)}\n\`\`\``);
  if (input.repositoryTree.length > 0) {
    blocks.push(`### Repository tree (partial)\n${input.repositoryTree.slice(0, 160).join("\n")}`);
  }
  if (input.likelyTests.length > 0) {
    blocks.push(`### Likely tests from the code graph\n${input.likelyTests.map((path) => `- ${path}`).join("\n")}`);
  }
  blocks.push("Design the verification harness now. Return the JSON object only.");
  return blocks.join("\n\n");
}

export function verifyRepairSystem(): string {
  return [
    "You are the coordinator diagnosing a failed sandbox verification of a drafted code fix. You see the hypothesis, the fix plan, the exact edits, and the command output that failed.",
    "",
    "Rules:",
    "- Diagnose the root cause: wrong edit, incomplete edit, wrong verification command, missing dependency, or a pre-existing failure unrelated to the fix.",
    "- If the fix can be corrected, return action `repair` with a concrete revised plan for the engineer. The engineer will rewrite the edits from the pristine head; you may extend the fix outside the PR diff.",
    "- The engineer can only replace text that already exists in a file with find/replace edits: never plan a new file, a file deletion or a rewrite. When the correct fix seems to need a new module, fold it into the existing changed file or say the hypothesis is not fixable.",
    "- You may also replace the verification commands and probe files when the harness itself was wrong. Probe files from the previous harness are kept unless you overwrite them by path; commands that reference a `probe/...` file must include its full content in `probeFiles`.",
    "- If the source edit is already correct and only the harness was wrong, say so and return a revised plan; the engineer will keep the existing edits.",
    "- When the harness was too weak, upgrade it: a probe that only inspects source text must be replaced by one that imports and executes the changed code, and the repository's typecheck/test command must stay in the harness.",
    "- If the failure is environmental, say so explicitly in the diagnosis; the pipeline will not treat it as a fix failure.",
    "- If no correct fix exists, return action `unfixable` with the reason.",
    "- Never suggest weakening tests, deleting validation, or hiding errors to make verification pass.",
    "",
    "Answer with JSON only:",
    '{"action":"repair","diagnosis":"...","revisedPlan":{"summary":"...","steps":["..."],"files":["path"],"risks":"...","testIdea":"..."},"commands":[{"cmd":"npm run check","why":"...","timeoutMs":180000}],"probeFiles":[{"path":"probe/verify.test.ts","content":"..."}],"mustFailBefore":[]}',
    'or {"action":"unfixable","diagnosis":"..."}',
  ].join("\n");
}

export interface VerifyRepairInput {
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
  commands: VerifyPlan["commands"];
  probeFiles: VerifyPlan["probeFiles"];
  fileSnapshots: Array<{ path: string; content: string }>;
}

export function verifyRepairUser(input: VerifyRepairInput): string {
  const blocks: string[] = [];
  blocks.push(
    `## Pull request #${input.pullRequestNumber} — ${input.title || "(no title)"}\n` +
      `Repository: ${input.repository} · head ${input.headSha.slice(0, 8)} · attempt ${input.attempt} of ${input.maxAttempts}`,
  );
  blocks.push(
    `### Hypothesis (id ${input.hypothesis.id})\n` +
      `${input.hypothesis.file}:${input.hypothesis.line} · ${input.hypothesis.mechanism} · ${input.hypothesis.severity}\n` +
      `${input.hypothesis.change}\nwhy: ${input.hypothesis.why}\ndeciding question: ${input.hypothesis.question}`,
  );
  blocks.push(
    `### Original fix plan\n${input.plan.summary}\n` +
      input.plan.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
  );
  blocks.push(`### Edits that failed\n${renderEditsForPrompt(input.edits)}`);
  blocks.push(
    `### Verification harness\n${input.commands.map((command) => `- \`${command.cmd}\` — ${command.why}`).join("\n") || "(no commands)"}` +
      (input.probeFiles.length > 0 ? `\nprobe files: ${input.probeFiles.map((probe) => probe.path).join(", ")}` : ""),
  );
  blocks.push(`### Failure\n${input.failure.slice(0, 6_000)}`);
  for (const snapshot of input.fileSnapshots.slice(0, 4)) {
    blocks.push(`### Current file: ${snapshot.path}\n\`\`\`\n${snapshot.content.slice(0, 6_000)}\n\`\`\``);
  }
  blocks.push("Diagnose the failure and return the JSON object now.");
  return blocks.join("\n\n");
}
