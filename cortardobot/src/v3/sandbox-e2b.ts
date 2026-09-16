import { Sandbox as E2BSandbox } from "e2b";
import type { ApplyResult, BrowserCheck, BrowserCheckResult, ExecResult, RepairEdit } from "./types";
import { buildBrowserScript, type RepoProfile, type Sandbox } from "./sandbox";
import { isTestPath } from "./patch";

export interface E2BSandboxOptions {
  template: string;
  apiKey: string;
  timeoutMs: number;
  repoDir: string;
}

/** POSIX single-quote escaping for every dynamic shell token. */
function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
  signal?: AbortSignal;
}

export class E2BSandboxInstance implements Sandbox {
  readonly id: string;
  readonly root: string;
  private readonly box: E2BSandbox;
  private readonly workDir: string;
  private stopped = false;

  private constructor(box: E2BSandbox, repoDir: string) {
    this.box = box;
    this.id = box.sandboxId;
    this.root = repoDir;
    this.workDir = "/home/user/cortado";
  }

  static async create(options: E2BSandboxOptions): Promise<E2BSandboxInstance> {
    const box = await E2BSandbox.create(options.template, { apiKey: options.apiKey, timeoutMs: options.timeoutMs });
    return new E2BSandboxInstance(box, options.repoDir);
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    const started = Date.now();
    try {
      const result = await this.box.commands.run(command, {
        cwd: options.cwd ?? this.root,
        timeoutMs: options.timeoutMs ?? 120_000,
        signal: options.signal,
      });
      return {
        command,
        exitCode: result.exitCode,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        durationMs: Date.now() - started,
        timedOut: false,
      };
    } catch (error) {
      const candidate = error as { exitCode?: number; stdout?: string; stderr?: string; message?: string; name?: string };
      const aborted = options.signal?.aborted === true || candidate.name === "AbortError";
      const timedOut = aborted || /timeout|timed out/i.test(candidate.message ?? "");
      return {
        command,
        exitCode: typeof candidate.exitCode === "number" ? candidate.exitCode : timedOut ? 124 : 1,
        stdout: candidate.stdout ?? "",
        stderr: `${candidate.stderr ?? ""}${candidate.message ? `\n${candidate.message}` : ""}`.trim(),
        durationMs: Date.now() - started,
        timedOut,
      };
    }
  }

  async prepare(options: { cloneUrl: string; token: string; ref: string; headBranch?: string }): Promise<void> {
    const tokenized = options.cloneUrl.replace(/^https:\/\//, `https://x-access-token:${options.token}@`);
    const parent = this.root.split("/").slice(0, -1).join("/") || "/home/user";
    await this.exec(`rm -rf ${sh(this.root)} && mkdir -p ${sh(this.root)}`, { cwd: parent, timeoutMs: 30_000 });
    const clone = await this.exec(`git clone --quiet --depth 50 ${sh(tokenized)} ${sh(this.root)}`, { cwd: parent, timeoutMs: 180_000 });
    if (clone.exitCode !== 0) {
      const retry = await this.exec(`git init -q ${sh(this.root)} && git -C ${sh(this.root)} remote add origin ${sh(tokenized)}`, { cwd: parent, timeoutMs: 60_000 });
      if (retry.exitCode !== 0) throw new Error(`git init failed: ${retry.stderr.slice(0, 300)}`);
    }
    const refs = [options.ref, options.headBranch ? `refs/heads/${options.headBranch}` : undefined].filter(
      (value): value is string => Boolean(value),
    );
    let checkedOut = false;
    for (const ref of refs) {
      const fetch = await this.exec(`git -C ${sh(this.root)} fetch --quiet --depth 50 origin ${sh(ref)}`, { timeoutMs: 180_000 });
      if (fetch.exitCode !== 0) continue;
      const checkout = await this.exec(`git -C ${sh(this.root)} checkout --quiet --force FETCH_HEAD`, { timeoutMs: 60_000 });
      if (checkout.exitCode === 0) {
        checkedOut = true;
        break;
      }
    }
    if (!checkedOut) {
      throw new Error(`could not check out ${options.ref}: ${refs.join(", ")}`);
    }
    // The installation token must not stay in the remote configuration.
    await this.exec(`git -C ${sh(this.root)} remote set-url origin ${sh(options.cloneUrl)}`, { timeoutMs: 30_000, allowFailure: true });
    await this.exec(`git -C ${sh(this.root)} config user.email "bot@cortado.dev" && git -C ${sh(this.root)} config user.name "Cortado Bot"`, { timeoutMs: 30_000 });
  }

  async install(): Promise<void> {
    const hasModules = await this.exists(`${this.root}/node_modules`);
    if (hasModules) return;
    const hasPnpm = await this.exists(`${this.root}/pnpm-lock.yaml`);
    const hasYarn = await this.exists(`${this.root}/yarn.lock`);
    const hasLock = (await this.exists(`${this.root}/package-lock.json`)) || (await this.exists(`${this.root}/npm-shrinkwrap.json`));
    const primary = hasPnpm
      ? "pnpm install --prefer-offline --loglevel=error"
      : hasYarn
        ? "yarn install --prefer-offline --loglevel=error"
        : hasLock
          ? "npm ci --no-audit --no-fund --prefer-offline --loglevel=error"
          : "npm install --no-audit --no-fund --loglevel=error";
    const fallback = hasPnpm ? "pnpm install --prefer-offline" : hasYarn ? "yarn install --prefer-offline" : "npm install --no-audit --no-fund --loglevel=error";
    const result = await this.exec(primary, { cwd: this.root, timeoutMs: 600_000 });
    if (result.exitCode !== 0) {
      const retry = await this.exec(fallback, { cwd: this.root, timeoutMs: 600_000 });
      if (retry.exitCode !== 0) {
        throw new Error(`dependency install failed: ${retry.stderr.slice(-600)}`);
      }
    }
  }

  async profile(): Promise<RepoProfile> {
    const packageJson = await this.read(`${this.root}/package.json`).catch(() => "{}");
    let parsed: { scripts?: Record<string, string> } = {};
    try {
      parsed = JSON.parse(packageJson);
    } catch {
      parsed = {};
    }
    const scripts = parsed.scripts ?? {};
    const hasPnpm = await this.exists(`${this.root}/pnpm-lock.yaml`);
    const hasYarn = await this.exists(`${this.root}/yarn.lock`);
    const packageManager = hasPnpm ? "pnpm" : hasYarn ? "yarn" : "npm";
    const installCommand = packageManager === "pnpm" ? "pnpm install --prefer-offline" : packageManager === "yarn" ? "yarn install --prefer-offline" : "npm ci --no-audit --no-fund --prefer-offline";
    const testScript = scripts.test && !/no test specified/i.test(scripts.test) ? scripts.test : undefined;
    const hasVitest = await this.exists(`${this.root}/node_modules/.bin/vitest`);
    const hasJest = await this.exists(`${this.root}/node_modules/.bin/jest`);
    const testCommand = testScript
      ? "npm test --silent"
      : hasVitest
        ? "npx vitest run"
        : hasJest
          ? "npx jest"
          : undefined;
    const testSingle = testScript
      ? (file: string) => `npm test --silent -- ${file}`
      : hasVitest
        ? (file: string) => `npx vitest run ${file}`
        : hasJest
          ? (file: string) => `npx jest ${file}`
          : undefined;
    const typecheckCommand = scripts.check
      ? "npm run check --silent"
      : scripts.typecheck
        ? "npm run typecheck --silent"
        : (await this.exists(`${this.root}/tsconfig.json`))
          ? "npx tsc --noEmit"
          : undefined;
    const buildCommand = scripts.build ? "npm run build --silent" : undefined;
    const hasVite = (await this.exists(`${this.root}/vite.config.ts`)) || (await this.exists(`${this.root}/vite.config.js`));
    const devCommand = hasVite ? "npx vite" : scripts.dev ? "npm run dev" : undefined;
    let testFiles: string[] = [];
    try {
      testFiles = (await this.list(this.root)).filter((file) => isTestPath(file)).slice(0, 300);
    } catch {
      testFiles = [];
    }
    return {
      packageManager,
      installCommand,
      hasNodeModules: await this.exists(`${this.root}/node_modules`),
      hasTests: Boolean(testCommand),
      testCommand,
      testSingle,
      typecheckCommand,
      buildCommand,
      devCommand,
      scripts,
      testFiles,
    };
  }

  private resolvePath(path: string): string {
    return path.startsWith("/") ? path : `${this.root}/${path}`;
  }

  async read(path: string): Promise<string> {
    return this.box.files.read(this.resolvePath(path));
  }

  async write(path: string, content: string): Promise<void> {
    await this.box.files.write(this.resolvePath(path), content);
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.exec(`test -e ${sh(this.resolvePath(path))} && echo yes || echo no`, { timeoutMs: 30_000 });
    return result.stdout.trim() === "yes";
  }

  async list(dir = this.root): Promise<string[]> {
    const result = await this.exec(`cd ${sh(dir)} && find . -type f -not -path "./node_modules/*" -not -path "./.git/*" | sed 's|^\\./||' | head -400`, { timeoutMs: 60_000 });
    return result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  async applyEdits(edits: RepairEdit[]): Promise<ApplyResult> {
    if (edits.length === 0) return { ok: false, applied: [], failed: [] };
    const absolute = edits.map((edit) => ({ ...edit, path: edit.path.startsWith("/") ? edit.path : `${this.root}/${edit.path}` }));
    await this.exec(`mkdir -p ${this.workDir}`, { cwd: "/home/user", timeoutMs: 30_000 });
    await this.write(`${this.workDir}/edits.json`, JSON.stringify(absolute));
    await this.write(`${this.workDir}/apply-edits.cjs`, APPLY_EDITS_SCRIPT);
    const result = await this.exec(`node ${this.workDir}/apply-edits.cjs ${this.workDir}/edits.json ${this.workDir}/apply-result.json`, {
      cwd: this.workDir,
      timeoutMs: 60_000,
      allowFailure: true,
    });
    const raw = await this.read(`${this.workDir}/apply-result.json`).catch(() => "");
    try {
      const parsed = JSON.parse(raw) as { ok: boolean; results: Array<{ ok: boolean; edit: RepairEdit; reason?: string }> };
      const originalByAbsolute = new Map(absolute.map((edit, index) => [edit.path, edits[index]]));
      return {
        ok: parsed.ok && result.exitCode === 0,
        applied: parsed.results.filter((entry) => entry.ok).map((entry) => originalByAbsolute.get(entry.edit.path) ?? entry.edit),
        failed: parsed.results
          .filter((entry) => !entry.ok)
          .map((entry) => ({ edit: originalByAbsolute.get(entry.edit.path) ?? entry.edit, reason: entry.reason ?? "apply failed" })),
      };
    } catch {
      return { ok: false, applied: [], failed: edits.map((edit) => ({ edit, reason: `apply script failed: ${result.stderr.slice(-300)}` })) };
    }
  }

  async gitDiff(): Promise<string> {
    await this.exec("git add -A", { cwd: this.root, timeoutMs: 60_000, allowFailure: true });
    const result = await this.exec("git diff --cached --no-color", { cwd: this.root, timeoutMs: 60_000 });
    return result.stdout;
  }

  private async resolveDevCommand(port: number): Promise<string> {
    const hasVite = (await this.exists(`${this.root}/vite.config.ts`)) || (await this.exists(`${this.root}/vite.config.js`)) || (await this.exists(`${this.root}/vite.config.mjs`));
    if (hasVite) return `npx vite --host 127.0.0.1 --port ${port} --strictPort --clearScreen false`;
    const packageJson = await this.read(`${this.root}/package.json`).catch(() => "{}");
    try {
      const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {};
      if (scripts.dev) return `npm run dev -- --host 127.0.0.1 --port ${port}`;
    } catch {
      // fall through to the vite default
    }
    return `npx vite --host 127.0.0.1 --port ${port} --strictPort --clearScreen false`;
  }

  async startApp(options: { port?: number; command?: string; readyPath?: string } = {}): Promise<{ url: string; stop: () => Promise<void> }> {
    const port = options.port ?? 4173;
    const command = options.command ?? (await this.resolveDevCommand(port));
    await this.exec("pkill -f 'vite' || true", { timeoutMs: 15_000, allowFailure: true }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 800));
    await this.exec(`mkdir -p ${sh(this.workDir)}`, { cwd: "/home/user", timeoutMs: 30_000 });
    const handle = await this.box.commands.run(`(${command}) > ${sh(this.workDir)}/dev.log 2>&1`, {
      cwd: this.root,
      background: true,
      timeoutMs: 300_000,
      envs: { NODE_ENV: "development", BROWSER: "none" },
    });
    const url = `http://127.0.0.1:${port}`;
    const readyPath = options.readyPath ?? "/";
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (Date.now() < deadline) {
      const probe = await this.exec(`curl -sf -o /dev/null -w "%{http_code}" ${url}${readyPath}`, { timeoutMs: 15_000, allowFailure: true });
      if (probe.stdout.trim().startsWith("2") || probe.stdout.trim().startsWith("3")) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (!ready) {
      const logs = await this.exec(`tail -n 40 ${this.workDir}/dev.log 2>/dev/null || true`, { timeoutMs: 15_000, allowFailure: true });
      await this.box.commands.kill(handle.pid).catch(() => undefined);
      throw new Error(`dev server did not become ready on ${url}${readyPath}. ${logs.stdout.slice(-400)}`);
    }
    return {
      url,
      stop: async () => {
        await this.box.commands.kill(handle.pid).catch(() => undefined);
        await this.exec("pkill -f 'vite' || true", { timeoutMs: 15_000, allowFailure: true }).catch(() => undefined);
      },
    };
  }

  async browserChecks(checks: Array<{ id: string; check: BrowserCheck }>, baseUrl: string): Promise<BrowserCheckResult[]> {
    await this.exec(`mkdir -p ${this.workDir}`, { cwd: "/home/user", timeoutMs: 30_000 });
    await this.write(`${this.workDir}/browser-check.cjs`, buildBrowserScript());
    await this.write(`${this.workDir}/checks.json`, JSON.stringify({ baseUrl, checks }));
    const result = await this.exec(
      `PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright NODE_PATH=$(npm root -g) node ${this.workDir}/browser-check.cjs ${this.workDir}/checks.json`,
      {
        cwd: this.workDir,
        timeoutMs: Math.max(90_000, checks.length * 45_000),
        allowFailure: true,
      },
    );
    try {
      const start = result.stdout.indexOf("{");
      const parsed = JSON.parse(result.stdout.slice(start)) as { results?: BrowserCheckResult[]; error?: string };
      if (parsed.results) return parsed.results;
      throw new Error(parsed.error ?? "browser script returned no results");
    } catch (error) {
      return checks.map((entry) => ({
        id: entry.id,
        path: entry.check.path,
        passed: false,
        pageErrors: [],
        consoleErrors: [],
        detail: `browser check failed to run: ${error instanceof Error ? error.message : String(error)} ${result.stderr.slice(0, 200)}`,
        durationMs: 0,
        harnessError: true,
      }));
    }
  }

  async cleanup(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.box.kill().catch(() => undefined);
  }
}

const APPLY_EDITS_SCRIPT = `const fs = require("fs");
const edits = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const results = [];
for (const edit of edits) {
  try {
    const content = fs.readFileSync(edit.path, "utf8");
    const count = content.split(edit.find).length - 1;
    if (count === 0) throw new Error("find text not found in " + edit.path);
    if (count > 1) throw new Error("find text is ambiguous (" + count + " matches) in " + edit.path);
    fs.writeFileSync(edit.path, content.replace(edit.find, edit.replace), "utf8");
    results.push({ ok: true, edit });
  } catch (error) {
    results.push({ ok: false, edit, reason: String(error && error.message ? error.message : error) });
  }
}
const ok = results.every((entry) => entry.ok);
fs.writeFileSync(process.argv[3], JSON.stringify({ ok, results }));
process.exit(ok ? 0 : 1);
`;
