import type { Candidate, ContextPack, ContextPackFile, PRContext, ProofResult } from "../types";
import type { RepoProfile, Sandbox } from "../sandbox";
import { renderCompactDiff, renderNumberedFile } from "../patch";
import { hashContent, normalizeLearnings, renderLearnings, stableStringify, truncate } from "../util";

const MAX_FILES = 6;
const MAX_PACK_CHARS = 60_000;

export interface BuildContextPackInput {
  candidate: Candidate;
  context: PRContext;
  sandbox: Sandbox;
  profile: RepoProfile;
  proof: ProofResult;
  instructions?: string;
}

async function readIfExists(sandbox: Sandbox, path: string): Promise<string | undefined> {
  try {
    return await sandbox.read(path);
  } catch {
    return undefined;
  }
}

function extractImports(content: string): string[] {
  const specifiers = new Set<string>();
  for (const match of content.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) specifiers.add(match[1]);
  for (const match of content.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) specifiers.add(match[1]);
  return [...specifiers];
}

function dirname(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") parts.pop();
    else parts.push(segment);
  }
  return parts.join("/");
}

/** Tolerant JSONC parse for tsconfig.json (comments + trailing commas). */
function parseJsonc(text: string): Record<string, unknown> {
  const withoutComments = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(withoutTrailingCommas) as Record<string, unknown>;
  } catch {
    return {};
  }
}

interface AliasRule {
  prefix: string;
  targets: string[];
}

async function loadAliasRules(sandbox: Sandbox, root: string): Promise<AliasRule[]> {
  const raw = await readIfExists(sandbox, `${root}/tsconfig.json`);
  if (!raw) return [];
  const parsed = parseJsonc(raw);
  const paths = ((parsed.compilerOptions as Record<string, unknown> | undefined)?.paths ?? {}) as Record<string, string[]>;
  const rules: AliasRule[] = [];
  for (const [key, targets] of Object.entries(paths)) {
    if (!Array.isArray(targets) || targets.length === 0) continue;
    rules.push({ prefix: key.replace(/\*$/, ""), targets: targets.map((target) => target.replace(/\*$/, "").replace(/^\.\//, "")) });
  }
  return rules;
}

async function resolveSpecifier(sandbox: Sandbox, fromFile: string, specifier: string, aliases: AliasRule[]): Promise<string | undefined> {
  const candidates: string[] = [];
  if (specifier.startsWith(".")) {
    candidates.push(normalizePath(`${dirname(fromFile)}/${specifier}`));
  } else {
    for (const rule of aliases) {
      if (rule.prefix && specifier.startsWith(rule.prefix)) {
        const suffix = specifier.slice(rule.prefix.length);
        for (const target of rule.targets) candidates.push(normalizePath(`${target}${suffix}`));
      }
    }
    if (candidates.length === 0) return undefined;
  }
  const extensions = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", "/index.ts", "/index.tsx", "/index.js"];
  for (const candidate of candidates) {
    for (const extension of extensions) {
      const path = `${candidate}${extension}`;
      if (await sandbox.exists(path)) return path;
    }
  }
  return undefined;
}

function extractSymbols(content: string): string[] {
  const symbols = new Set<string>();
  for (const match of content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) symbols.add(match[1]);
  for (const match of content.matchAll(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) symbols.add(match[1]);
  for (const match of content.matchAll(/(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) symbols.add(match[1]);
  return [...symbols].slice(0, 40);
}

/**
 * Builds the context pack an agent needs to understand the change: the touched
 * file, the local modules it imports, tests that cover it, aliases, symbols and
 * the reproduction evidence. Files are budgeted so prompts stay bounded.
 */
export async function buildContextPack(input: BuildContextPackInput): Promise<ContextPack> {
  const { candidate, context, sandbox, proof } = input;
  const root = sandbox.root;
  const files: ContextPackFile[] = [];
  const seen = new Set<string>();
  let totalChars = 0;

  const addFile = async (path: string, changed: boolean): Promise<void> => {
    if (seen.has(path) || files.length >= MAX_FILES) return;
    const content = await readIfExists(sandbox, path);
    if (content === undefined) return;
    if (totalChars + content.length > MAX_PACK_CHARS && files.length > 0) return;
    seen.add(path);
    totalChars += content.length;
    files.push({ path, content, numbered: renderNumberedFile(content), hash: hashContent(content), changed });
  };

  const target = candidate.file;
  const aliases = await loadAliasRules(sandbox, root);
  const imports: string[] = [];
  const symbols: string[] = [];

  if (target) {
    await addFile(target, true);
    const content = await readIfExists(sandbox, target);
    if (content) {
      symbols.push(...extractSymbols(content));
      for (const specifier of extractImports(content)) {
        const resolved = await resolveSpecifier(sandbox, target, specifier, aliases);
        if (resolved && !resolved.includes("node_modules")) {
          imports.push(resolved);
          await addFile(resolved, false);
        }
      }
    }
  }

  const tests: string[] = [];
  const base = target ? (target.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "") : "";
  for (const test of context.tests) {
    const testBase = test.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
    if (base && (testBase === base || testBase.startsWith(`${base}.`) || testBase.startsWith(`${base}-`))) {
      tests.push(test);
    }
  }
  for (const test of tests.slice(0, 2)) await addFile(test, false);

  const pack: ContextPack = {
    candidateId: candidate.id,
    files,
    imports: [...new Set(imports)],
    symbols: [...new Set(symbols)],
    tests,
    routes: context.pages.filter((page) => page.file === target).map((page) => page.route),
    diff: truncate(renderCompactDiff(context.files.filter((file) => file.path === target), { maxChars: 12_000, contextLines: 12 }), 12_000),
    reproduction: truncate(proof.reproduction, 1_200),
    check: candidate.check,
    detectorEvidence: candidate.evidence,
    instructions: input.instructions,
    learnings: normalizeLearnings(context.learnings),
    hash: "",
  };
  pack.hash = hashContent(
    stableStringify({
      files: files.map((file) => [file.path, file.hash]),
      reproduction: pack.reproduction,
      check: pack.check ?? null,
      diff: pack.diff,
      learnings: pack.learnings ?? [],
    }),
  );
  return pack;
}

const SWARM_MAX_FILES = 10;
const SWARM_MAX_CHARS = 70_000;

export interface BuildSwarmContextInput {
  context: PRContext;
  sandbox: Sandbox;
  profile: RepoProfile;
  instructions?: string;
}

/**
 * Repo-level context for the read-only swarm investigators. Unlike the repair
 * context pack this is not tied to a candidate: it contains every changed file,
 * the compact diff, the test inventory and the routes so each investigator can
 * start from the same grounded view and then explore with tools.
 */
export async function buildSwarmContext(input: BuildSwarmContextInput): Promise<ContextPack> {
  const { context, sandbox, profile } = input;
  const files: ContextPackFile[] = [];
  let totalChars = 0;

  for (const file of context.files) {
    if (files.length >= SWARM_MAX_FILES) break;
    if (file.status === "removed") continue;
    const content = (await readIfExists(sandbox, file.path)) ?? file.content;
    if (content === undefined) continue;
    if (totalChars + content.length > SWARM_MAX_CHARS && files.length > 0) continue;
    totalChars += content.length;
    files.push({ path: file.path, content, numbered: renderNumberedFile(content), hash: hashContent(content), changed: true });
  }

  const diff = truncate(renderCompactDiff(context.files, { maxChars: 20_000, contextLines: 8 }), 20_000);
  const pack: ContextPack = {
    candidateId: "swarm-context",
    files,
    imports: [],
    symbols: context.symbols.slice(0, 40).map((symbol) => `${symbol.kind} ${symbol.name} (${symbol.file}:${symbol.line})`),
    tests: context.tests.slice(0, 20),
    routes: context.routes.slice(0, 20),
    diff,
    reproduction: "",
    detectorEvidence: [],
    instructions: input.instructions,
    learnings: normalizeLearnings(context.learnings),
    hash: "",
  };
  pack.hash = hashContent(
    stableStringify({
      files: files.map((file) => [file.path, file.hash]),
      diff,
      tests: pack.tests,
      profile: [profile.testCommand ?? "", profile.typecheckCommand ?? "", profile.buildCommand ?? ""],
      learnings: pack.learnings ?? [],
    }),
  );
  return pack;
}

/** Renders the repo-level swarm context for the first investigator turn. */
export function renderSwarmContext(pack: ContextPack): string {
  const blocks: string[] = ["## Repository context"];
  if (pack.diff) blocks.push(`### Diff (changed lines marked ">")\n${pack.diff}`);
  for (const file of pack.files) {
    blocks.push(`### File ${file.path} (changed)\n${file.numbered}`);
  }
  if (pack.tests.length > 0) blocks.push(`### Test files in the repository\n- ${pack.tests.join("\n- ")}`);
  if (pack.routes.length > 0) blocks.push(`### Routes\n- ${pack.routes.join("\n- ")}`);
  if (pack.symbols.length > 0) blocks.push(`### Symbols changed by this PR\n- ${pack.symbols.join("\n- ")}`);
  if (pack.instructions) blocks.push(`### Reviewer instructions\n${truncate(pack.instructions, 800)}`);
  const learnings = renderLearnings(pack.learnings);
  if (learnings) blocks.push(`### Repository learnings (follow these)\n${learnings}`);
  blocks.push('Use the read-only tools (read_file, list_dir, find_files, search_code, get_symbols, find_references, get_tests_for, read_test, git_diff) to inspect anything that is not shown here.');
  return blocks.join("\n\n");
}

/** Renders the pack for the first agent turn. */
export function renderContextPack(pack: ContextPack): string {
  const blocks: string[] = [];
  blocks.push("## Codebase context");
  if (pack.diff) blocks.push(`### Diff (changed lines marked ">")\n${pack.diff}`);
  for (const file of pack.files) {
    blocks.push(`### File ${file.path}${file.changed ? " (changed)" : " (related)"}\n${file.numbered}`);
  }
  if (pack.imports.length > 0) blocks.push(`### Local imports\n- ${pack.imports.join("\n- ")}`);
  if (pack.symbols.length > 0) blocks.push(`### Symbols in the changed file\n- ${pack.symbols.join(", ")}`);
  if (pack.tests.length > 0) blocks.push(`### Tests covering this file\n- ${pack.tests.join("\n- ")}`);
  if (pack.routes.length > 0) blocks.push(`### Routes\n- ${pack.routes.join(", ")}`);
  if (pack.check) blocks.push(`### Authoritative browser check\n${pack.check.label} at ${pack.check.path} (expected ${pack.check.expected})`);
  if (pack.reproduction) blocks.push(`### Reproduction evidence (pre-fix)\n${pack.reproduction}`);
  if (pack.detectorEvidence.length > 0) blocks.push(`### Evidence anchors\n- ${pack.detectorEvidence.join("\n- ")}`);
  if (pack.instructions) blocks.push(`### Reviewer instructions\n${truncate(pack.instructions, 800)}`);
  const learnings = renderLearnings(pack.learnings);
  if (learnings) blocks.push(`### Repository learnings (follow these)\n${learnings}`);
  return blocks.join("\n\n");
}
