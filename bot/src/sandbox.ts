import type { Sandbox } from "e2b";
import type { FixEdit, SandboxCommandRun, VerifyCommand, VerifyPlan, VerifyProbeFile } from "./types.ts";

export interface SandboxExecOptions {
  cwd?: string;
  timeoutMs?: number;
  envs?: Record<string, string>;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface VerifySandbox {
  readonly id: string;
  exec(cmd: string, options?: SandboxExecOptions): Promise<SandboxExecResult>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  close(): Promise<void>;
}

export const E2B_HOME = "/home/user";
export const SANDBOX_REPO_DIR = `${E2B_HOME}/repo`;
const MAX_TAIL = 8_000;

export function redact(text: string): string {
  return text
    .replace(/x-access-token:[^@\s]+@/gi, "x-access-token:***@")
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, "github_pat_***")
    .replace(/gh[pousr]_[A-Za-z0-9]{20,}/g, "gh_***")
    .replace(/e2b_[A-Za-z0-9]{10,}/g, "e2b_***")
    .replace(/sk-[A-Za-z0-9]{16,}/g, "sk-***");
}

export function tail(value: string, max = MAX_TAIL): string {
  if (value.length <= max) return value;
  return `…${value.slice(value.length - max + 1)}`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 300) return false;
  if (path.startsWith("/") || path.startsWith("~")) return false;
  if (path.includes("\0") || path.includes("\\")) return false;
  const segments = path.split("/");
  return !segments.some((segment) => segment === ".." || segment.length === 0);
}

class E2bVerifySandbox implements VerifySandbox {
  constructor(private readonly sandbox: Sandbox) {}

  get id(): string {
    return this.sandbox.sandboxId;
  }

  async exec(cmd: string, options: SandboxExecOptions = {}): Promise<SandboxExecResult> {
    try {
      const result = await this.sandbox.commands.run(cmd, {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        envs: options.envs,
      });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr, timedOut: false };
    } catch (error) {
      const shaped = error as { exitCode?: number; stdout?: string; stderr?: string; message?: string };
      if (typeof shaped.exitCode === "number") {
        return {
          exitCode: shaped.exitCode,
          stdout: redact(shaped.stdout ?? ""),
          stderr: redact(shaped.stderr ?? ""),
          timedOut: false,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      if (/timed?\s*out|timeout/i.test(message)) {
        return { exitCode: 124, stdout: "", stderr: redact(message), timedOut: true };
      }
      throw new Error(`sandbox command failed to start: ${redact(message).slice(0, 300)}`);
    }
  }

  async read(path: string): Promise<string> {
    return await this.sandbox.files.read(path, { format: "text" });
  }

  async write(path: string, content: string): Promise<void> {
    await this.sandbox.files.write(path, content);
  }

  async close(): Promise<void> {
    await this.sandbox.kill().catch(() => undefined);
  }
}

export interface CreateSandboxInput {
  template: string;
  timeoutMs: number;
  apiKey?: string;
  metadata?: Record<string, string>;
}

export async function createE2bSandbox(input: CreateSandboxInput): Promise<VerifySandbox> {
  const { Sandbox: E2bSandboxApi } = await import("e2b");
  const sandbox = await E2bSandboxApi.create(input.template, {
    timeoutMs: input.timeoutMs,
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  });
  return new E2bVerifySandbox(sandbox);
}

export interface ClonePullRequestInput {
  fullName: string;
  pullRequestNumber: number;
  headSha: string;
  token: string;
  dir?: string;
  timeoutMs?: number;
}

export interface ClonePullRequestResult {
  dir: string;
  headSha: string;
  durationMs: number;
}

export async function clonePullRequest(
  sandbox: VerifySandbox,
  input: ClonePullRequestInput,
): Promise<ClonePullRequestResult> {
  const [owner, repo] = input.fullName.split("/");
  if (!owner || !repo) throw new Error(`invalid repository name: ${input.fullName}`);
  const dir = input.dir ?? SANDBOX_REPO_DIR;
  const timeoutMs = input.timeoutMs ?? 180_000;
  const authenticated = `https://x-access-token:${input.token}@github.com/${owner}/${repo}.git`;
  const clean = `https://github.com/${owner}/${repo}.git`;
  const started = Date.now();
  const steps = [
    `rm -rf ${shellQuote(dir)}`,
    `git init -q ${shellQuote(dir)}`,
    `git -C ${shellQuote(dir)} remote add origin ${shellQuote(authenticated)}`,
    `git -C ${shellQuote(dir)} fetch --depth 1 -q origin ${shellQuote(`refs/pull/${input.pullRequestNumber}/head`)}`,
    `git -C ${shellQuote(dir)} checkout -q --detach FETCH_HEAD`,
  ];
  for (const step of steps) {
    const result = await sandbox.exec(step, { cwd: E2B_HOME, timeoutMs });
    if (result.exitCode !== 0) {
      throw new Error(`sandbox clone failed: ${redact(result.stderr || result.stdout).slice(0, 300)}`);
    }
  }
  const head = await sandbox.exec(`git -C ${shellQuote(dir)} rev-parse HEAD`, { cwd: E2B_HOME, timeoutMs: 30_000 });
  const headSha = head.stdout.trim();
  await sandbox.exec(`git -C ${shellQuote(dir)} remote set-url origin ${shellQuote(clean)}`, {
    cwd: E2B_HOME,
    timeoutMs: 30_000,
  });
  if (head.exitCode !== 0 || headSha !== input.headSha) {
    throw new Error(`sandbox checkout is ${headSha || "unknown"}, expected ${input.headSha}`);
  }
  return { dir, headSha, durationMs: Date.now() - started };
}

export interface InstallPlan {
  cmd: string | null;
  reason: string;
}

export function detectInstallCommand(paths: string[], override?: string): InstallPlan {
  if (override?.trim()) return { cmd: override.trim(), reason: "configured install command" };
  const has = (name: string) => paths.some((path) => path === name);
  if (!has("package.json")) return { cmd: null, reason: "no package.json at the repository root" };
  if (has("pnpm-lock.yaml")) {
    return { cmd: "corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile", reason: "pnpm-lock.yaml" };
  }
  if (has("yarn.lock")) {
    return { cmd: "corepack enable >/dev/null 2>&1 || true; yarn install --frozen-lockfile", reason: "yarn.lock" };
  }
  if (has("bun.lockb") || has("bun.lock")) return { cmd: "bun install", reason: "bun.lock" };
  if (has("package-lock.json")) return { cmd: "npm ci --no-audit --no-fund", reason: "package-lock.json" };
  return { cmd: "npm install --no-audit --no-fund", reason: "package.json" };
}

function testFileCandidates(paths: string[]): string[] {
  return paths
    .filter((path) => !path.includes("node_modules/"))
    .filter((path) => /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$/i.test(path))
    .slice(0, 3);
}

export interface FallbackVerifyPlanInput {
  paths: string[];
  packageJson?: string;
  overrideCommands?: string[];
  commandTimeoutMs: number;
}

export function fallbackVerifyPlan(input: FallbackVerifyPlanInput): VerifyPlan {
  if (input.overrideCommands?.length) {
    return {
      commands: input.overrideCommands.map((cmd) => ({
        cmd,
        why: "configured verification command",
        timeoutMs: input.commandTimeoutMs,
      })),
      probeFiles: [],
      mustFailBefore: [],
      source: "override",
    };
  }
  let scripts: Record<string, string> = {};
  if (input.packageJson) {
    try {
      const parsed = JSON.parse(input.packageJson) as { scripts?: Record<string, string> };
      scripts = parsed.scripts ?? {};
    } catch {
      scripts = {};
    }
  }
  const scriptFor = (...names: string[]): string | undefined => {
    for (const name of names) {
      if (typeof scripts[name] === "string" && scripts[name].trim()) return name;
    }
    return undefined;
  };
  const commands: VerifyCommand[] = [];
  const test = scriptFor("test", "test:unit", "unit");
  if (test) commands.push({ cmd: `npm run ${test} --silent`, why: "the repository's own test script", timeoutMs: input.commandTimeoutMs });
  const check = scriptFor("check", "typecheck", "type-check", "tsc");
  if (check) commands.push({ cmd: `npm run ${check} --silent`, why: "the repository's own typecheck script", timeoutMs: input.commandTimeoutMs });
  if (commands.length === 0) {
    const byExtension = testFileCandidates(input.paths);
    const tsFiles = byExtension.some((path) => path.endsWith(".ts") || path.endsWith(".tsx"));
    if (byExtension.length > 0) {
      commands.push({
        cmd: `node ${tsFiles ? "--import tsx " : ""}--test ${byExtension.map((path) => shellQuote(path)).join(" ")}`,
        why: "existing test files detected in the repository",
        timeoutMs: input.commandTimeoutMs,
      });
    }
  }
  if (commands.length === 0) {
    const build = scriptFor("build", "build:server", "build:client");
    if (build) commands.push({ cmd: `npm run ${build} --silent`, why: "the repository's own build script", timeoutMs: input.commandTimeoutMs });
  }
  const notes =
    commands.length === 0
      ? "no test, typecheck or build script was found; verification has no command to run"
      : undefined;
  return { commands, probeFiles: [], mustFailBefore: [], source: "fallback", notes };
}

export interface ApplyEditsResult {
  files: Map<string, string>;
  errors: string[];
  changed: string[];
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function applyEditsToFiles(files: Map<string, string>, edits: FixEdit[]): ApplyEditsResult {
  const next = new Map(files);
  const errors: string[] = [];
  const changed = new Set<string>();
  for (const edit of edits) {
    const content = next.get(edit.path);
    if (content === undefined) {
      errors.push(`${edit.path}: file not present in the sandbox`);
      continue;
    }
    const occurrences = countOccurrences(content, edit.find);
    if (occurrences === 0) {
      errors.push(`${edit.path}: find text no longer matches the sandbox file`);
      continue;
    }
    if (occurrences > 1) {
      errors.push(`${edit.path}: find text matches ${occurrences} times in the sandbox file`);
      continue;
    }
    next.set(edit.path, content.replace(edit.find, edit.replace));
    changed.add(edit.path);
  }
  return { files: next, errors, changed: [...changed] };
}

export async function applyEditsToSandbox(
  sandbox: VerifySandbox,
  dir: string,
  edits: FixEdit[],
): Promise<{ errors: string[]; changed: string[] }> {
  const paths = [...new Set(edits.map((edit) => edit.path))];
  const files = new Map<string, string>();
  for (const path of paths) {
    try {
      files.set(path, await sandbox.read(`${dir}/${path}`));
    } catch {
      continue;
    }
  }
  const applied = applyEditsToFiles(files, edits);
  for (const path of applied.changed) {
    await sandbox.write(`${dir}/${path}`, applied.files.get(path)!);
  }
  return { errors: applied.errors, changed: applied.changed };
}

export async function writeProbeFiles(
  sandbox: VerifySandbox,
  dir: string,
  probeFiles: VerifyProbeFile[],
): Promise<string[]> {
  const written: string[] = [];
  for (const probe of probeFiles) {
    if (!isSafeRelativePath(probe.path)) continue;
    await sandbox.write(`${dir}/${probe.path}`, probe.content);
    written.push(probe.path);
  }
  return written;
}

export async function resetWorktree(sandbox: VerifySandbox, dir: string): Promise<string[]> {
  const errors: string[] = [];
  for (const cmd of [
    `git -C ${shellQuote(dir)} checkout -q -f FETCH_HEAD`,
    `git -C ${shellQuote(dir)} clean -qfd`,
  ]) {
    const result = await sandbox.exec(cmd, { cwd: E2B_HOME, timeoutMs: 60_000 });
    if (result.exitCode !== 0) errors.push(redact(result.stderr || result.stdout).slice(0, 200));
  }
  return errors;
}

export interface RunCommandsInput {
  sandbox: VerifySandbox;
  dir: string;
  commands: VerifyCommand[];
  defaultTimeoutMs: number;
  deadline?: number;
  /** Decides whether a command executes repository code or only inspects text. */
  isBehavioral?: (cmd: string) => boolean;
  onLog?: (message: string) => void;
}

export async function runSandboxCommands(input: RunCommandsInput): Promise<SandboxCommandRun[]> {
  const runs: SandboxCommandRun[] = [];
  for (const command of input.commands) {
    const timeoutMs = Math.min(command.timeoutMs > 0 ? command.timeoutMs : input.defaultTimeoutMs, input.defaultTimeoutMs);
    if (input.deadline && Date.now() > input.deadline) break;
    const started = Date.now();
    const result = await input.sandbox.exec(command.cmd, { cwd: input.dir, timeoutMs });
    const run: SandboxCommandRun = {
      cmd: command.cmd,
      why: command.why,
      exitCode: result.exitCode,
      timedOut: result.timedOut,
      durationMs: Date.now() - started,
      stdoutTail: tail(redact(result.stdout)),
      stderrTail: tail(redact(result.stderr)),
      behavioral: input.isBehavioral ? input.isBehavioral(command.cmd) : true,
    };
    runs.push(run);
    input.onLog?.(`verify: ${result.exitCode === 0 ? "ok" : "fail"} (${result.exitCode}) ${command.cmd}`);
  }
  return runs;
}
