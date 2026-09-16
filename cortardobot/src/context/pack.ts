/**
 * PR context: the launchpad every agent starts from. It is deliberately a
 * summary plus impact evidence, not the whole repository — agents fetch what
 * they need with tools.
 */
import type { Finding, ParsedFile, RepoProfile, ReviewRequest } from "../types";
import { parseChangedFiles, renderCompactDiff, renderNumberedFile } from "../patch";
import { normalizeLearnings, renderLearnings, truncate } from "../util";
import { GraphIndex, type ImpactSlice } from "./graph";

export interface PRContext {
  runId: string;
  repo: ReviewRequest["repo"];
  pr: ReviewRequest["pr"];
  changed: ParsedFile[];
  changedFiles: string[];
  additions: number;
  deletions: number;
  classification: string[];
  size: string;
  routes: string[];
  riskSignals: string[];
  learnings: string[];
  instructions?: string;
  graph: GraphIndex;
  profile: RepoProfile;
  impact: ImpactSlice;
}

function classify(paths: string[], contents: string[]): string[] {
  const labels = new Set<string>();
  for (const path of paths) {
    if (/(^|\/)(client|app|ui)\/|\.tsx$/.test(path)) labels.add("UI");
    if (/(^|\/)(server|api|routes)\//.test(path) || /route|handler/.test(path)) labels.add("API");
    if (/schema|migration|\.sql$/.test(path)) labels.add("DB");
    if (/auth|session|login|oauth|token/i.test(path)) labels.add("AUTH");
    if (/\/pages\//.test(path)) labels.add("UI");
  }
  if (contents.some((content) => /useQuery|fetch\(|axios/.test(content))) labels.add("DATA");
  if (contents.some((content) => /useState|useEffect|localStorage|sessionStorage/.test(content))) labels.add("STATE");
  return [...labels].slice(0, 4).length > 0 ? [...labels].slice(0, 4) : ["GENERAL"];
}

function sizeOf(additions: number, deletions: number): string {
  const total = additions + deletions;
  if (total < 30) return "small";
  if (total < 150) return "medium";
  if (total < 600) return "large";
  return "complex";
}

function routesFor(paths: string[]): string[] {
  const routes = new Set<string>();
  for (const path of paths) {
    const match = /(?:^|\/)(?:client|src)\/pages\/(.+)\.(tsx|jsx|ts|js)$/.exec(path);
    if (!match) continue;
    const segment = match[1]
      .replace(/\/index$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase();
    if (!segment || segment.includes("[")) continue;
    routes.add(segment === "index" || segment === "home" ? "/" : `/${segment}`);
  }
  return [...routes].slice(0, 20);
}

function riskSignalsFor(paths: string[], contents: string[]): string[] {
  const signals = new Set<string>();
  const joined = `${paths.join(" ")} ${contents.join(" ")}`;
  if (/auth|session|login|oauth|password|jwt/i.test(joined)) signals.add("authentication/authorization");
  if (/payment|billing|stripe|checkout|price/i.test(joined)) signals.add("billing");
  if (/crypto|encrypt|secret|api[_-]?key/i.test(joined)) signals.add("secrets/crypto");
  if (/migration|schema\.ts|\.sql$/i.test(joined)) signals.add("schema/migration");
  if (/localStorage|sessionStorage|indexedDB/i.test(joined)) signals.add("persistent client state");
  if (/delete|drop|truncate|destroy/i.test(joined)) signals.add("destructive operations");
  return [...signals].slice(0, 6);
}

export function deriveContext(request: ReviewRequest, graph: GraphIndex, profile: RepoProfile): PRContext {
  const changed = parseChangedFiles(request.files);
  for (const file of changed) {
    if (file.content !== undefined) graph.overlay(file.path, file.content);
  }
  const changedFiles = changed.map((file) => file.path);
  const contents = changed.map((file) => file.content ?? "").filter(Boolean);
  const additions = changed.reduce((total, file) => total + file.additions, 0);
  const deletions = changed.reduce((total, file) => total + file.deletions, 0);
  return {
    runId: request.runId,
    repo: request.repo,
    pr: request.pr,
    changed,
    changedFiles,
    additions,
    deletions,
    classification: classify(changedFiles, contents),
    size: sizeOf(additions, deletions),
    routes: routesFor(changedFiles),
    riskSignals: riskSignalsFor(changedFiles, contents),
    learnings: normalizeLearnings(request.learnings ?? []),
    instructions: request.settings.instructions,
    graph,
    profile,
    impact: graph.impact(changedFiles, profile.testFiles ?? []),
  };
}

function impactLines(impact: ImpactSlice): string[] {
  const lines: string[] = [];
  if (impact.changedSymbols.length > 0) {
    lines.push("### Symbols changed by this PR");
    for (const symbol of impact.changedSymbols.slice(0, 24)) {
      lines.push(`- ${symbol.kind} ${symbol.qualifiedName} (${symbol.fileId}:${symbol.line})`);
    }
    lines.push("");
  }
  if (impact.callers.length > 0) {
    lines.push("### Code that calls into the changed symbols (outside the diff)");
    for (const ref of impact.callers.slice(0, 24)) {
      lines.push(`- ${ref.symbol.qualifiedName} (${ref.symbol.fileId}:${ref.symbol.line}) — calls into changed code, depth ${ref.depth}`);
    }
    lines.push("");
  }
  if (impact.stringConsumers.length > 0) {
    lines.push("### Other places using keys/strings that appear in this diff");
    for (const consumer of impact.stringConsumers.slice(0, 24)) {
      lines.push(`- "${consumer.value}" read at ${consumer.path}:${consumer.line}${consumer.changed ? " (changed file)" : ""}`);
    }
    lines.push("");
  }
  if (impact.importers.length > 0) {
    lines.push("### Files importing the changed files");
    lines.push(`- ${impact.importers.slice(0, 20).join("\n- ")}`);
    lines.push("");
  }
  if (impact.tests.length > 0) {
    lines.push("### Tests that cover the changed files");
    lines.push(`- ${impact.tests.join("\n- ")}`);
    lines.push("");
  }
  if (impact.callees.length > 0) {
    lines.push("### What the changed code calls");
    for (const ref of impact.callees.slice(0, 12)) {
      lines.push(`- ${ref.symbol.qualifiedName} (${ref.symbol.fileId}:${ref.symbol.line})`);
    }
    lines.push("");
  }
  return lines;
}

export interface SwarmContextOptions {
  investigator: string;
  focus: string;
  maxContentChars?: number;
}

/** Repo-level launchpad for a read-only investigator. */
export function renderSwarmContext(context: PRContext, options: SwarmContextOptions): string {
  const blocks: string[] = [];
  blocks.push(
    `## Pull request #${context.pr.number} — ${context.pr.title || "(no title)"}\n` +
      `Author: ${context.pr.author ?? "unknown"} · branch ${context.pr.headBranch} → ${context.pr.baseBranch} · ${context.size} change (+${context.additions}/-${context.deletions})`,
  );
  if (context.pr.body?.trim()) blocks.push(`### PR description\n${truncate(context.pr.body.trim(), 2_000)}`);
  blocks.push(`### Your assignment\n${options.investigator}: ${options.focus}`);
  blocks.push(`### Classification\n${context.classification.join(" / ")}${context.riskSignals.length > 0 ? ` · risk: ${context.riskSignals.join(", ")}` : ""}`);

  blocks.push(
    `### Diff (changed lines marked ">")\n${truncate(
      renderCompactDiff(context.changed, { maxChars: 24_000, contextLines: 10 }),
      24_000,
    )}`,
  );

  const contentBudget = options.maxContentChars ?? 40_000;
  let used = 0;
  const fileBlocks: string[] = [];
  for (const file of context.changed) {
    if (file.status === "removed" || file.content === undefined) continue;
    if (used + file.content.length > contentBudget && fileBlocks.length > 0) break;
    used += file.content.length;
    fileBlocks.push(`#### ${file.path}\n${renderNumberedFile(file.content)}`);
  }
  if (fileBlocks.length > 0) blocks.push(`### Changed file contents\n${fileBlocks.join("\n\n")}`);

  blocks.push(...impactLines(context.impact));
  if (context.routes.length > 0) blocks.push(`### Routes in scope\n- ${context.routes.join("\n- ")}`);
  if (context.instructions) blocks.push(`### Reviewer instructions\n${truncate(context.instructions, 1_200)}`);
  const learnings = renderLearnings(context.learnings);
  if (learnings) blocks.push(`### Repository learnings (follow these)\n${learnings}`);
  blocks.push(
    "Use the tools to inspect anything not shown here. The diff and the impact list are a starting point, not the answer. Read the real code before you claim anything.",
  );
  return blocks.join("\n\n");
}

/** Per-finding context for the engineer and for verification. */
export function renderFindingContext(context: PRContext, finding: Finding, extra?: string[]): string {
  const blocks: string[] = [];
  blocks.push(`## Defect to fix\n${finding.claim}`);
  blocks.push(`**Where:** \`${finding.file}${finding.line ? `:${finding.line}` : ""}\``);
  if (finding.evidence.length > 0) blocks.push(`**Evidence:** ${finding.evidence.join(", ")}`);
  blocks.push(`**Reproduction script:** \`${finding.repro.artifact.path}\``);
  blocks.push("```\n" + truncate(finding.repro.artifact.content, 4_000) + "\n```");
  blocks.push(`**Run with:** \`${finding.repro.artifact.command}\``);
  blocks.push(`**Failing output (on the current head):**\n\`\`\`\n${truncate(finding.repro.output, 2_400)}\n\`\`\``);

  const file = context.changed.find((entry) => entry.path === finding.file);
  if (file) {
    blocks.push(`### Diff for ${finding.file}\n${truncate(renderCompactDiff([file], { maxChars: 12_000, contextLines: 12 }), 12_000)}`);
    if (file.content) blocks.push(`### Current file ${finding.file}\n${renderNumberedFile(file.content)}`);
  }

  const relatedCallers = context.impact.callers.filter((ref) => ref.symbol.fileId === finding.file);
  if (relatedCallers.length > 0) {
    blocks.push(`### Callers of the changed code in this file`);
    for (const ref of relatedCallers.slice(0, 12)) {
      blocks.push(`- ${ref.symbol.qualifiedName} (${ref.symbol.fileId}:${ref.symbol.line})`);
    }
  }
  if (context.impact.tests.length > 0) blocks.push(`### Tests that cover this area\n- ${context.impact.tests.join("\n- ")}`);
  if (context.profile.testCommand) blocks.push(`### Repository test command\n\`${context.profile.testCommand}\``);
  if (context.profile.typecheckCommand) blocks.push(`### Typecheck command\n\`${context.profile.typecheckCommand}\``);
  if (context.instructions) blocks.push(`### Reviewer instructions\n${truncate(context.instructions, 1_000)}`);
  const learnings = renderLearnings(context.learnings);
  if (learnings) blocks.push(`### Repository learnings (follow these)\n${learnings}`);
  if (extra && extra.length > 0) blocks.push(...extra);
  return blocks.join("\n\n");
}

