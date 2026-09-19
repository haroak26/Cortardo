import type {
  CodegraphFileGraph,
  CodegraphReport,
  FixReport,
  GeneratedFix,
  HypothesisDownstream,
  HypothesisReport,
  Hypothesis,
  HypothesisSeverity,
  ModelRoleUsage,
  SandboxCommandRun,
  VerifyAttempt,
  VerifiedFix,
  VerifyReport,
} from "./types.ts";
import { renderFixDiff } from "./patch.ts";

export const CODEBOT_MARKER = "<!-- codebot -->";
export const CODEGRAPH_MARKER = `${CODEBOT_MARKER}\n<!-- codebot:stage=codegraph -->`;
export const HYPOTHESES_MARKER = `${CODEBOT_MARKER}\n<!-- codebot:stage=hypotheses -->`;
export const FIXES_MARKER = `${CODEBOT_MARKER}\n<!-- codebot:stage=fixes -->`;
export const VERIFY_MARKER = `${CODEBOT_MARKER}\n<!-- codebot:stage=verify -->`;

/**
 * The product comment: one review per run. It carries the generic marker so
 * publishing it replaces every legacy per-stage comment in one pass.
 */
export const REVIEW_MARKER = `${CODEBOT_MARKER}\n<!-- codebot:review -->`;

function short(value: string, max = 200): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function fileLink(repository: string, headSha: string, path: string): string {
  return `[\`${path}\`](https://github.com/${repository}/blob/${headSha}/${path})`;
}

function formatDelta(additions: number, deletions: number): string {
  return `+${additions}/-${deletions}`;
}

function symbolTable(file: CodegraphFileGraph): string[] {
  const lines: string[] = [];
  lines.push("| Symbol | Kind | Lines | Exported |");
  lines.push("| --- | --- | ---: | --- |");
  for (const symbol of file.symbols) {
    const linesRange = symbol.endLine > symbol.line ? `${symbol.line}-${symbol.endLine}` : String(symbol.line);
    lines.push(`| \`${short(symbol.qualifiedName || symbol.name, 80)}\` | ${symbol.kind} | ${linesRange} | ${symbol.exported ? "yes" : "no"} |`);
  }
  return lines;
}

function bulletList(items: string[]): string[] {
  return items.map((item) => `- ${item}`);
}

function fileSection(repository: string, headSha: string, file: CodegraphFileGraph): string[] {
  const lines: string[] = [];
  const counts = [
    `${file.symbols.length} symbol(s)`,
    `${file.callers.length} caller(s)`,
    `${file.tests.length} likely test(s)`,
  ];
  lines.push(`<details>`);
  lines.push(`<summary>${fileLink(repository, headSha, file.path)} — ${counts.join(" · ")}</summary>`);
  lines.push("");
  lines.push(`**Language:** ${file.language} · **Kind:** ${file.kind} · **LOC:** ${file.loc} · **Status:** ${file.status} · **In index:** ${file.indexed ? "yes" : "no"}`);
  lines.push("");

  if (file.symbols.length > 0) {
    lines.push("**Symbols defined**");
    lines.push("");
    lines.push(...symbolTable(file));
    lines.push("");
  }

  if (file.imports.length > 0) {
    lines.push(`**Imports (${file.imports.length})**`);
    lines.push("");
    lines.push(...bulletList(file.imports.map((entry) => `\`${entry.path}\`${entry.changed ? " (changed in this PR)" : ""}`)));
    lines.push("");
  }

  if (file.importedBy.length > 0) {
    lines.push(`**Imported by (${file.importedBy.length})**`);
    lines.push("");
    lines.push(...bulletList(file.importedBy.map((path) => `\`${path}\``)));
    lines.push("");
  }

  if (file.callers.length > 0) {
    lines.push(`**Callers (${file.callers.length})** — symbols outside the diff that call into this file`);
    lines.push("");
    lines.push(...bulletList(file.callers.map((caller) => `\`${caller.file}#${caller.symbol}\` calls \`${caller.via}\``)));
    lines.push("");
  }

  if (file.callees.length > 0) {
    lines.push(`**Callees (${file.callees.length})** — symbols this file calls`);
    lines.push("");
    lines.push(...bulletList(file.callees.map((callee) => `\`${callee.file}#${callee.symbol}\``)));
    lines.push("");
  }

  if (file.tests.length > 0) {
    lines.push(`**Likely tests (${file.tests.length})**`);
    lines.push("");
    lines.push(...bulletList(file.tests.map((path) => `\`${path}\``)));
    lines.push("");
  }

  lines.push("</details>");
  return lines;
}

export interface BuildCodegraphCommentInput {
  report: CodegraphReport;
  runId: string;
  version: string;
}

export function buildCodegraphComment(input: BuildCodegraphCommentInput): string {
  const { report } = input;
  const head = report.headSha.slice(0, 8);
  const index = report.indexCommitSha ? `\`${report.indexCommitSha.slice(0, 8)}\` (${report.indexFileCount} files)` : "none";
  const lines: string[] = [];

  lines.push(CODEGRAPH_MARKER);
  lines.push("## CodeBot · Stage 1: codegraph");
  lines.push("");
  lines.push(
    `\`${report.repository}\` · PR #${report.pullRequestNumber} · head \`${head}\` · code index ${index}`,
  );
  lines.push("");
  lines.push(
    `**${report.totals.files} changed file(s) · ${report.totals.symbols} symbol(s) · ` +
      `${report.totals.callers} caller(s) · ${report.totals.tests} likely test(s)**`,
  );
  lines.push("");
  lines.push("This stage reports only the code graph for the files in this diff. Findings and fixes are later stages.");
  lines.push("");

  lines.push("### Changed files");
  lines.push("");
  lines.push("| File | Status | Delta | Language | Symbols | Callers | Tests |");
  lines.push("| --- | --- | --- | --- | ---: | ---: | ---: |");
  for (const file of report.files) {
    lines.push(
      `| ${fileLink(report.repository, report.headSha, file.path)} | ${file.status} | ${formatDelta(file.additions, file.deletions)} | ` +
        `${file.language} | ${file.symbols.length} | ${file.callers.length} | ${file.tests.length} |`,
    );
  }
  lines.push("");

  if (report.files.length === 0) {
    lines.push("No analyzable source files changed in this diff.");
    lines.push("");
  }

  for (const file of report.files) {
    lines.push(...fileSection(report.repository, report.headSha, file));
    lines.push("");
  }

  if (report.unsupported.length > 0) {
    lines.push("### Not analyzed");
    lines.push("");
    lines.push(...bulletList(report.unsupported.map((path) => `\`${path}\` — not an analyzable source file`)));
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("### Notes");
    lines.push("");
    lines.push(...bulletList(report.warnings));
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Run \`${input.runId}\` · CodeBot ${input.version} · stage 1 of the CodeBot pipeline (codegraph only)._`);
  return lines.join("\n");
}

function downstreamText(refs: HypothesisDownstream[]): string {
  return refs
    .map((ref) => (ref.symbol ? "`" + ref.file + "#" + ref.symbol + "` (" + ref.relation + ")" : "`" + ref.file + "` (" + ref.relation + ")"))
    .join(", ");
}

function hypothesisSection(repository: string, headSha: string, hypothesis: Hypothesis, index: number): string[] {
  const lines: string[] = [];
  lines.push(`### ${index + 1}. \`${hypothesis.mechanism}\` · **${hypothesis.severity.toUpperCase()}** — ${fileLink(repository, headSha, hypothesis.file)}:${hypothesis.line}`);
  lines.push("");
  lines.push(`**Changed:** \`${short(hypothesis.change, 240)}\`${hypothesis.symbol ? ` in \`${hypothesis.symbol}\`` : ""}`);
  lines.push("");
  lines.push(`**Why it is risky:** ${hypothesis.why}`);
  lines.push("");
  if (hypothesis.downstream.length > 0) {
    lines.push(`**Downstream from the graph:** ${downstreamText(hypothesis.downstream)}`);
    lines.push("");
  }
  lines.push(`**Confirm or kill it:** ${hypothesis.question}`);
  lines.push("");
  lines.push(
    `<sub>Advisory \`${hypothesis.id}\`${hypothesis.priority ? ` · priority #${hypothesis.priority}` : ""} · ${hypothesis.ruleId} · ` +
      `confidence ${hypothesis.confidence.toFixed(2)} · unproven — not a finding · ` +
      `dismiss with \`npm run bot:learnings -- --dismiss ${hypothesis.id}\`</sub>`,
  );
  return lines;
}

function usageLine(label: string, usage: ModelRoleUsage): string {
  if (usage.calls === 0) return `${label}: not used`;
  const hitRate = usage.tokensIn > 0 ? Math.round((usage.cachedTokensIn / usage.tokensIn) * 100) : 0;
  const cache = usage.cachedTokensIn > 0 ? ` · ${usage.cachedTokensIn} cached (${hitRate}%)` : "";
  const failed = usage.failedCalls > 0 ? ` · ${usage.failedCalls} failed call(s)` : "";
  return `${label}: \`${usage.id}\` ×${usage.calls} · ${usage.tokensIn} in / ${usage.tokensOut} out${cache} · $${usage.costUsd.toFixed(4)}${failed}`;
}

export interface BuildHypothesesCommentInput {
  report: HypothesisReport;
  runId: string;
  version: string;
}

export function buildHypothesesComment(input: BuildHypothesesCommentInput): string {
  const { report } = input;
  const head = report.headSha.slice(0, 8);
  const index = report.indexCommitSha ? `\`${report.indexCommitSha.slice(0, 8)}\`` : "none";
  const usageLines = report.usage.used
    ? [
        `_${usageLine("Coordinator", report.usage.coordinator)}_`,
        `_${usageLine("Swarm", report.usage.swarm)}_`,
        `_Total $${report.usage.totalCostUsd.toFixed(4)} of $${report.usage.maxCostUsd.toFixed(2)} budget` +
          `${report.dismissed > 0 ? ` · ${report.dismissed} dismissed hypothesis(es) suppressed` : ""}_`,
      ]
    : [
        `_Model tiers skipped: ${report.usage.reason ?? "not configured"}` +
          `${report.dismissed > 0 ? ` · ${report.dismissed} dismissed hypothesis(es) suppressed` : ""}_`,
      ];

  const lines: string[] = [];
  lines.push(HYPOTHESES_MARKER);
  lines.push("## CodeBot · Stage 2: hypotheses");
  lines.push("");
  lines.push(`\`${report.repository}\` · PR #${report.pullRequestNumber} · head \`${head}\` · code index ${index}`);
  lines.push("");
  lines.push(
    `**${report.totals.hypotheses} hypothesis(s) · ${report.totals.critical + report.totals.high} high priority · ` +
      `${report.totals.medium} medium · ${report.totals.low} low**`,
  );
  lines.push("");
  lines.push(
    "> These are hypotheses from the diff and the code graph — unproven, non-blocking advisories. " +
      "Nothing here is a confirmed finding until a reproduction proves it.",
  );
  lines.push("");

  if (report.hypotheses.length === 0) {
    lines.push("No suspicious changes found in this diff.");
    lines.push("");
  } else {
    report.hypotheses.forEach((hypothesis, index) => {
      lines.push(...hypothesisSection(report.repository, report.headSha, hypothesis, index));
      lines.push("");
    });
  }

  if (report.warnings.length > 0) {
    lines.push("### Notes");
    lines.push("");
    lines.push(...bulletList(report.warnings));
    lines.push("");
  }

  lines.push("---");
  lines.push(...usageLines);
  lines.push(`_${report.totals.hypotheses} advisory(ies) · stage 2 of the CodeBot pipeline (hypotheses)._`);
  lines.push(`_Run \`${input.runId}\` · CodeBot ${input.version}._`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stage 3 — fixes
// ---------------------------------------------------------------------------

function fixSection(repository: string, headSha: string, fix: GeneratedFix, index: number): string[] {
  const lines: string[] = [];
  const hypothesis = fix.hypothesis;
  lines.push(
    `### ${index + 1}. Fix for \`${hypothesis.id}\` · **${hypothesis.severity.toUpperCase()}** · priority #${fix.priority || "-"} — ` +
      `${fileLink(repository, headSha, hypothesis.file)}:${hypothesis.line}`,
  );
  lines.push("");
  lines.push(`**Hypothesis:** ${short(hypothesis.change, 240)}`);
  lines.push("");
  if (fix.plan) {
    lines.push(`**Plan:** ${fix.plan.summary}`);
    lines.push("");
    if (fix.plan.steps.length > 0) {
      lines.push(fix.plan.steps.map((step, stepIndex) => `${stepIndex + 1}. ${step}`).join("\n"));
      lines.push("");
    }
    if (fix.plan.files.length > 0) {
      lines.push(`**Planned files:** ${fix.plan.files.map((file) => `\`${file}\``).join(", ")}`);
      lines.push("");
    }
    if (fix.plan.risks) {
      lines.push(`**Risk:** ${fix.plan.risks}`);
      lines.push("");
    }
  }
  if (fix.outcome === "generated") {
    lines.push("**Proposed patch (draft):**");
    lines.push("");
    lines.push("```diff");
    lines.push(renderFixDiff(fix.edits));
    lines.push("```");
    lines.push("");
    lines.push(`**Codegen summary:** ${fix.summary}`);
    lines.push("");
    const outside = fix.edits.filter((edit) => edit.outsideDiff).map((edit) => edit.path);
    if (outside.length > 0) {
      lines.push(`**Edits outside the diff:** ${[...new Set(outside)].map((path) => `\`${path}\``).join(", ")}`);
      lines.push("");
    }
    lines.push(
      `<sub>Confidence ${fix.confidence.toFixed(2)} · ${fix.attempts} attempt(s) · unverified draft — not compiled, tested or applied</sub>`,
    );
  } else {
    lines.push(`**Outcome:** \`${fix.outcome}\` — ${fix.reason ?? "no reason recorded"}`);
    lines.push("");
  }
  return lines;
}

export interface BuildFixesCommentInput {
  report: FixReport;
  runId: string;
  version: string;
}

export function buildFixesComment(input: BuildFixesCommentInput): string {
  const { report } = input;
  const head = report.headSha.slice(0, 8);
  const usage = report.usage;
  const lines: string[] = [];
  lines.push(FIXES_MARKER);
  lines.push("## CodeBot · Stage 3: fixes");
  lines.push("");
  lines.push(`\`${report.repository}\` · PR #${report.pullRequestNumber} · head \`${head}\``);
  lines.push("");
  const considered =
    report.totals.available > report.totals.hypotheses
      ? `${report.totals.hypotheses} of ${report.totals.available}`
      : `${report.totals.hypotheses}`;
  lines.push(
    `**${report.totals.generated} draft fix(es) · ${considered} hypothesis(es) considered · ` +
      `${report.totals.notFixable} not fixable · ${report.totals.refused} refused · ${report.totals.failed} failed · ${report.totals.skipped} skipped**`,
  );
  lines.push("");
  lines.push(
    "> Drafts generated from unproven hypotheses. Nothing here has been compiled, tested, applied or pushed — treat every patch as a starting point.",
  );
  if (report.suggestions.posted > 0 || report.suggestions.skipped > 0) {
    lines.push("");
    lines.push(
      `**${report.suggestions.posted} inline suggestion(s)** posted as a GitHub review` +
        (report.suggestions.skipped > 0
          ? ` · ${report.suggestions.skipped} edit(s) outside the diff stay in this comment.`
          : "."),
    );
  }
  lines.push("");

  if (report.fixes.length === 0) {
    lines.push("No hypotheses were available to fix.");
    lines.push("");
  } else {
    report.fixes.forEach((fix, index) => {
      lines.push(...fixSection(report.repository, report.headSha, fix, index));
      lines.push("");
    });
  }

  if (report.warnings.length > 0) {
    lines.push("### Notes");
    lines.push("");
    lines.push(...bulletList(report.warnings));
    lines.push("");
  }

  lines.push("---");
  lines.push(`_Planner: ${usageLine("Coordinator", usage.coordinator)}_`);
  lines.push(`_Codegen: ${usageLine("Codegen", usage.codegen)}_`);
  lines.push(
    `_Total $${usage.totalCostUsd.toFixed(4)} of $${usage.maxCostUsd.toFixed(2)} budget · ` +
      `${report.totals.generated} draft patch(es) · stage 3 of the CodeBot pipeline (fixes)._`,
  );
  lines.push(`_Run \`${input.runId}\` · CodeBot ${input.version}._`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Stage 4 — verify
// ---------------------------------------------------------------------------

const EVIDENCE_LABEL: Record<string, string> = {
  reproduction: "reproduction: the plan failed on the unfixed head and passed with the fix",
  probe: "probe: a purpose-built probe test passed with the fix",
  tests: "tests: the repository's test commands passed with the fix",
  compile: "compile: typecheck/build commands passed with the fix",
  static: "source check: text assertions only — the changed code was never executed",
  none: "no evidence",
};

const EVIDENCE_SHORT: Record<string, string> = {
  reproduction: "reproduction",
  probe: "probe test",
  tests: "tests",
  compile: "compile",
  static: "source check (not executed)",
  none: "no evidence",
};

const EVIDENCE_LEGEND =
  "Evidence: `reproduction` failed on the unfixed head and passes with the fix · `probe test` a purpose-built probe executed the changed code · " +
  "`tests` the repository's tests passed · `compile` typecheck/build passed · `source check` text assertions only — behavior was not exercised.";

function shortLog(run: SandboxCommandRun, max = 700): string {
  const output = (run.stderrTail || run.stdoutTail || "(no output)").trim();
  return short(output, max);
}

function attemptBlock(attempt: VerifyAttempt): string[] {
  const lines: string[] = [];
  lines.push(
    `**Attempt ${attempt.attempt}** (${attempt.kind}) — \`${attempt.status}\`${
      attempt.preExisting.length > 0 ? ` · ${attempt.preExisting.length} pre-existing failure(s) ignored` : ""
    }${attempt.reproductions > 0 ? ` · ${attempt.reproductions} reproduction(s)` : ""}`,
  );
  lines.push("");
  for (const run of attempt.runs) {
    const status = run.timedOut ? "timeout" : run.exitCode === 0 ? "pass" : `exit ${run.exitCode}`;
    const pre = attempt.preExisting.includes(run.cmd) ? " (pre-existing)" : "";
    const sourceOnly = run.behavioral === false ? " · source check" : "";
    lines.push(`- \`${short(run.cmd, 160)}\` — **${status}**${pre} · ${(run.durationMs / 1000).toFixed(1)}s${sourceOnly}`);
  }
  if (attempt.applyErrors.length > 0) {
    lines.push("");
    lines.push(...bulletList(attempt.applyErrors.map((error) => `apply error: ${error}`)));
  }
  const failed = attempt.runs.find((run) => run.exitCode !== 0 || run.timedOut);
  if (failed && !attempt.preExisting.includes(failed.cmd)) {
    lines.push("");
    lines.push(`<details><summary>Failure output — <code>${short(failed.cmd, 120)}</code></summary>`);
    lines.push("");
    lines.push("```");
    lines.push(shortLog(failed));
    lines.push("```");
    lines.push("");
    lines.push("</details>");
  }
  if (attempt.diagnosis) {
    lines.push("");
    lines.push(`**Diagnosis:** ${attempt.diagnosis}`);
  }
  lines.push("");
  return lines;
}

function verifyFixSection(repository: string, headSha: string, fix: VerifiedFix, index: number): string[] {
  const lines: string[] = [];
  const hypothesis = fix.hypothesis;
  const label = fix.status.toUpperCase();
  lines.push(
    `### ${index + 1}. **${label}** — fix for \`${hypothesis.id}\` · priority #${fix.priority || "-"} · ${hypothesis.severity} — ` +
      `${fileLink(repository, headSha, hypothesis.file)}:${hypothesis.line}`,
  );
  lines.push("");
  lines.push(`**Hypothesis:** ${short(hypothesis.change, 240)}`);
  lines.push("");
  if (fix.plan?.summary) {
    lines.push(`**Plan:** ${fix.plan.summary}`);
    lines.push("");
  }
  if (fix.status === "verified") {
    lines.push(
      `**Evidence:** ${EVIDENCE_LABEL[fix.evidence] ?? fix.evidence} · ${fix.attemptsUsed} attempt(s) · ` +
        `${(fix.durationMs / 1000).toFixed(1)}s${fix.install ? ` · install ${(fix.install.durationMs / 1000).toFixed(1)}s` : ""}`,
    );
    lines.push("");
    lines.push("**Verified patch:**");
    lines.push("");
    lines.push("```diff");
    lines.push(renderFixDiff(fix.edits));
    lines.push("```");
    lines.push("");
  } else if (fix.reason) {
    lines.push(`**Outcome:** \`${fix.status}\` — ${fix.reason}`);
    lines.push("");
  }
  if (fix.attempts.length > 0) {
    lines.push(`<details><summary>Attempt log (${fix.attempts.length})</summary>`);
    lines.push("");
    for (const attempt of fix.attempts) lines.push(...attemptBlock(attempt));
    lines.push("</details>");
    lines.push("");
  }
  return lines;
}

export interface BuildVerifyCommentInput {
  report: VerifyReport;
  runId: string;
  version: string;
}

export function buildVerifyComment(input: BuildVerifyCommentInput): string {
  const { report } = input;
  const head = report.headSha.slice(0, 8);
  const usage = report.usage;
  const totals = report.totals;
  const lines: string[] = [];
  lines.push(VERIFY_MARKER);
  lines.push("## CodeBot · Stage 4: verify (autmpus loop)");
  lines.push("");
  lines.push(`\`${report.repository}\` · PR #${report.pullRequestNumber} · head \`${head}\``);
  lines.push("");
  lines.push(
    `**${totals.verified} verified (${totals.behavioral ?? 0} ran the changed code) · ${totals.unverified} unverified · ` +
      `${totals.inconclusive} inconclusive · ${totals.skipped} skipped** of ${totals.eligible} priority fix(es) ` +
      `(${totals.attempts} attempt(s), ${totals.commands} command(s), ${totals.reproductions} reproduction(s))`,
  );
  lines.push("");
  lines.push(
    "> The fix was cloned with the PR head, applied in an E2B sandbox and checked by running real commands. " +
      "Only verified edits are offered as suggestions; verification is evidence, not a guarantee.",
  );
  if (report.sandbox.id) {
    lines.push("");
    lines.push(
      `<sub>Sandbox \`${report.sandbox.id}\` (${report.sandbox.template})` +
        `${report.sandbox.cloneMs !== undefined ? ` · clone ${(report.sandbox.cloneMs / 1000).toFixed(1)}s` : ""}` +
        `${report.sandbox.installMs !== undefined ? ` · install ${(report.sandbox.installMs / 1000).toFixed(1)}s` : ""}</sub>`,
    );
  }
  lines.push("");
  if (report.suggestions.posted > 0 || report.suggestions.removed > 0) {
    lines.push(
      `**${report.suggestions.posted} verified suggestion(s)** posted` +
        (report.suggestions.removed > 0 ? ` · ${report.suggestions.removed} draft suggestion(s) replaced` : "") +
        (report.suggestions.skipped > 0 ? ` · ${report.suggestions.skipped} edit(s) outside the diff stay in this comment` : "") +
        ".",
    );
    lines.push("");
  }
  if (report.fixes.length === 0) {
    lines.push("No priority fix was available to verify.");
    lines.push("");
  } else {
    report.fixes.forEach((fix, index) => {
      lines.push(...verifyFixSection(report.repository, report.headSha, fix, index));
      lines.push("");
    });
  }
  if (report.warnings.length > 0) {
    lines.push("### Notes");
    lines.push("");
    lines.push(...bulletList(report.warnings));
    lines.push("");
  }
  lines.push("---");
  lines.push(`_Planner (GLM 5.3): ${usageLine("Coordinator", usage.coordinator)}_`);
  lines.push(`_Repairs (GPT 5.6 Sol): ${usageLine("Codegen", usage.codegen)}_`);
  lines.push(
    `_Total $${usage.totalCostUsd.toFixed(4)} of $${usage.maxCostUsd.toFixed(2)} budget · ` +
      `stage 4 of the CodeBot pipeline (verify)._`,
  );
  lines.push(`_Run \`${input.runId}\` · CodeBot ${input.version}._`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// The single review comment
// ---------------------------------------------------------------------------

function findingFixLine(
  hypothesis: Hypothesis,
  fixReport: FixReport | undefined,
  verifyReport: VerifyReport | undefined,
  severities: HypothesisSeverity[] | undefined,
): string {
  const hypothesisId = hypothesis.id;
  const verified = verifyReport?.fixes.find((fix) => fix.hypothesisId === hypothesisId);
  if (verified) {
    if (verified.status === "verified") {
      const suggestion = verified.edits.some((edit) => edit.inDiff)
        ? "inline suggestion"
        : "no inline suggestion (edits outside the diff)";
      return `**verified in sandbox** · ${EVIDENCE_SHORT[verified.evidence] ?? verified.evidence} · ${verified.attemptsUsed} attempt(s) · ${suggestion}`;
    }
    return `**${verified.status}** — ${verified.reason ?? "no reason recorded"}`;
  }
  const draft = fixReport?.fixes.find((fix) => fix.hypothesisId === hypothesisId);
  if (!draft && severities && !severities.includes(hypothesis.severity)) {
    return `not a priority severity (${severities.join("/")}) — not fixed`;
  }
  if (!draft) return "no fix planned";
  if (draft.outcome === "generated") return "**draft only** — not sandbox-verified";
  return `**${draft.outcome.replace(/_/g, " ")}**${draft.reason ? ` — ${draft.reason}` : ""}`;
}

function reviewFindingSection(
  repository: string,
  headSha: string,
  hypothesis: Hypothesis,
  index: number,
  fixReport: FixReport | undefined,
  verifyReport: VerifyReport | undefined,
  severities: HypothesisSeverity[] | undefined,
): string[] {
  const lines: string[] = [];
  lines.push(
    `#### ${index + 1}. \`${hypothesis.mechanism}\` · **${hypothesis.severity.toUpperCase()}** — ` +
      `${fileLink(repository, headSha, hypothesis.file)}:${hypothesis.line}`,
  );
  lines.push("");
  lines.push(`**Changed:** \`${short(hypothesis.change, 240)}\``);
  lines.push("");
  lines.push(`**Why it is risky:** ${hypothesis.why}`);
  lines.push("");
  lines.push(`**Confirm or kill it:** ${hypothesis.question}`);
  lines.push("");
  lines.push(`**Fix:** ${findingFixLine(hypothesis, fixReport, verifyReport, severities)}`);
  lines.push("");
  const verified = verifyReport?.fixes.find((fix) => fix.hypothesisId === hypothesis.id);
  const outside = verified?.status === "verified" ? verified.edits.filter((edit) => !edit.inDiff) : [];
  if (outside.length > 0) {
    lines.push("**Verified edits outside the diff** (GitHub can only suggest in-diff lines):");
    lines.push("");
    lines.push("```diff");
    lines.push(renderFixDiff(outside));
    lines.push("```");
    lines.push("");
  }
  return lines;
}

function verifiedFixLine(fix: VerifiedFix): string {
  const outside = fix.edits.filter((edit) => !edit.inDiff).length;
  return (
    `- \`${fix.hypothesisId}\` · \`${fix.hypothesis.mechanism}\` · **${fix.severity.toUpperCase()}** — ` +
    `\`${fix.edits[0]?.path ?? fix.hypothesis.file}:${fix.hypothesis.line}\` · ` +
    `${EVIDENCE_SHORT[fix.evidence] ?? fix.evidence} · ${fix.attemptsUsed} attempt(s)` +
    (outside > 0 ? ` · ${outside} edit(s) outside the diff (patch above)` : " · posted as an inline suggestion")
  );
}

function verificationLog(fixes: VerifiedFix[]): string[] {
  const attempted = fixes.filter((fix) => fix.attempts.length > 0);
  if (attempted.length === 0) return [];
  const lines: string[] = [];
  lines.push(`<details><summary>Sandbox verification log (${attempted.length} fix(es), ${attempted.reduce((total, fix) => total + fix.attempts.length, 0)} attempt(s))</summary>`);
  lines.push("");
  for (const fix of attempted) {
    lines.push(
      `**\`${fix.hypothesisId}\` — ${fix.status}** · ${(fix.durationMs / 1000).toFixed(1)}s` +
        (fix.install ? ` · install ${(fix.install.durationMs / 1000).toFixed(1)}s` : ""),
    );
    lines.push("");
    if (fix.probeFiles && fix.probeFiles.length > 0) {
      lines.push(`<details><summary>Harness probes (${fix.probeFiles.length})</summary>`);
      lines.push("");
      for (const probe of fix.probeFiles) {
        lines.push(`\`${probe.path}\``);
        lines.push("");
        lines.push("```");
        lines.push(short(probe.content, 2_000));
        lines.push("```");
        lines.push("");
      }
      lines.push("</details>");
      lines.push("");
    }
    for (const attempt of fix.attempts) lines.push(...attemptBlock(attempt));
  }
  lines.push("</details>");
  lines.push("");
  return lines;
}

export interface BuildReviewCommentInput {
  hypothesisReport?: HypothesisReport;
  fixReport?: FixReport;
  verifyReport?: VerifyReport;
  /** Severities that were eligible for fixing; used to explain skipped findings. */
  severities?: HypothesisSeverity[];
  runId: string;
  version: string;
}

/**
 * One comment for the whole run: findings, the fix outcome for each, the
 * verified set (posted as inline suggestions) and a collapsed verify log.
 */
export function buildReviewComment(input: BuildReviewCommentInput): string {
  const { hypothesisReport, fixReport, verifyReport } = input;
  const findings: Hypothesis[] = hypothesisReport?.hypotheses?.length
    ? hypothesisReport.hypotheses
    : (fixReport?.fixes ?? []).map((fix) => fix.hypothesis);
  const repository =
    verifyReport?.repository ?? fixReport?.repository ?? hypothesisReport?.repository ?? "unknown";
  const pullRequestNumber =
    verifyReport?.pullRequestNumber ?? fixReport?.pullRequestNumber ?? hypothesisReport?.pullRequestNumber ?? 0;
  const headSha = verifyReport?.headSha ?? fixReport?.headSha ?? hypothesisReport?.headSha ?? "";
  const usage = verifyReport?.usage ?? fixReport?.usage ?? hypothesisReport?.usage;
  const generated = fixReport?.fixes.filter((fix) => fix.outcome === "generated").length ?? 0;
  const verifiedFixes = (verifyReport?.fixes ?? []).filter((fix) => fix.status === "verified");
  const highPriority = findings.filter(
    (hypothesis) => hypothesis.severity === "critical" || hypothesis.severity === "high",
  ).length;
  const warnings = [
    ...(hypothesisReport?.warnings ?? []),
    ...(fixReport?.warnings ?? []),
    ...(verifyReport?.warnings ?? []),
  ];

  const lines: string[] = [];
  lines.push(REVIEW_MARKER);
  lines.push("## CodeBot review");
  lines.push("");
  lines.push(
    `\`${repository}\` · PR #${pullRequestNumber}` +
      (headSha ? ` · head \`${headSha.slice(0, 8)}\`` : "") +
      (verifyReport?.sandbox.id ? ` · sandbox \`${verifyReport.sandbox.id}\`` : ""),
  );
  lines.push("");
  const behavioral = verifyReport?.totals.behavioral ?? 0;
  lines.push(
    `**${findings.length} finding(s) · ${highPriority} critical/high · ${generated} priority fix(es) drafted · ` +
      `${verifiedFixes.length}/${verifyReport?.totals.eligible ?? 0} verified in a sandbox` +
      (verifiedFixes.length > 0 ? ` · ${behavioral} ran the changed code` : "") +
      `**`,
  );
  lines.push("");
  lines.push(
    "> Findings are unproven advisories. Only the verified fixes are offered as inline suggestions; " +
      "everything is a proposal — review before applying.",
  );
  lines.push("");

  if (findings.length === 0) {
    lines.push("No suspicious changes were found in this diff.");
    lines.push("");
  } else {
    lines.push("### Findings");
    lines.push("");
    findings.forEach((hypothesis, index) => {
      lines.push(...reviewFindingSection(repository, headSha, hypothesis, index, fixReport, verifyReport, input.severities));
    });
  }

  if (verifiedFixes.length > 0) {
    lines.push("### Verified fixes");
    lines.push("");
    lines.push(
      `These passed commands in an E2B clone of the PR head; the evidence class says how much was actually exercised ` +
        `(runtime behavior, tests, or compile/source checks only). Each in-diff edit is one GitHub suggestion in the review above.`,
    );
    lines.push("");
    lines.push(`<sub>${EVIDENCE_LEGEND}</sub>`);
    lines.push("");
    lines.push(...verifiedFixes.map(verifiedFixLine));
    lines.push("");
  } else if (verifyReport && verifyReport.totals.eligible > 0) {
    lines.push("### Verified fixes");
    lines.push("");
    lines.push("No fix passed sandbox verification; no inline suggestion was posted.");
    lines.push("");
  }

  const log = verificationLog(verifyReport?.fixes ?? []);
  if (log.length > 0) {
    lines.push("### Verification detail");
    lines.push("");
    lines.push(...log);
  }

  if (warnings.length > 0) {
    lines.push("### Notes");
    lines.push("");
    lines.push(...bulletList([...new Set(warnings)]));
    lines.push("");
  }

  lines.push("---");
  if (usage) {
    lines.push(`_Coordinator (GLM 5.3): ${usageLine("Coordinator", usage.coordinator)}_`);
    lines.push(`_Codegen (GPT 5.6 Sol): ${usageLine("Codegen", usage.codegen)}_`);
    const totalCalls = usage.coordinator.calls + usage.swarm.calls + usage.codegen.calls;
    lines.push(
      `_Total $${usage.totalCostUsd.toFixed(4)} of $${usage.maxCostUsd.toFixed(2)} budget · ` +
        `${totalCalls} model call(s)._`,
    );
  }
  lines.push(`_Run \`${input.runId}\` · CodeBot ${input.version}._`);
  return lines.join("\n");
}
