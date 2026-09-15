import type { ApplyResult, BrowserCheck, BrowserCheckResult, ExecResult, RepairEdit } from "./types";
import type { RepoProfile, Sandbox } from "./sandbox";

export interface MemorySandboxOptions {
  files?: Record<string, string>;
  execHandler?: (command: string) => Partial<ExecResult>;
  browserHandler?: (checks: Array<{ id: string; check: BrowserCheck }>) => BrowserCheckResult[];
  profile?: Partial<RepoProfile>;
}

export class MemorySandbox implements Sandbox {
  readonly id = "memory-sandbox";
  readonly root = "/repo";
  private readonly files: Map<string, string>;
  private readonly execHandler?: MemorySandboxOptions["execHandler"];
  private readonly browserHandler?: MemorySandboxOptions["browserHandler"];
  private readonly profileOverride?: Partial<RepoProfile>;

  constructor(options: MemorySandboxOptions = {}) {
    this.files = new Map(Object.entries(options.files ?? {}));
    this.execHandler = options.execHandler;
    this.browserHandler = options.browserHandler;
    this.profileOverride = options.profile;
  }

  async prepare(): Promise<void> {}
  async install(): Promise<void> {}

  async profile(): Promise<RepoProfile> {
    return {
      packageManager: "npm",
      installCommand: "npm ci",
      hasNodeModules: true,
      hasTests: false,
      scripts: {},
      ...this.profileOverride,
    };
  }

  async exec(command: string): Promise<ExecResult> {
    const handled = this.execHandler?.(command);
    return {
      command,
      exitCode: 0,
      stdout: "",
      stderr: "",
      durationMs: 1,
      timedOut: false,
      ...handled,
    };
  }

  async read(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async list(): Promise<string[]> {
    return [...this.files.keys()];
  }

  async applyEdits(edits: RepairEdit[]): Promise<ApplyResult> {
    const applied: RepairEdit[] = [];
    const failed: ApplyResult["failed"] = [];
    for (const edit of edits) {
      const content = this.files.get(edit.path);
      if (content === undefined) {
        failed.push({ edit, reason: `file not found: ${edit.path}` });
        continue;
      }
      const count = content.split(edit.find).length - 1;
      if (count !== 1) {
        failed.push({ edit, reason: count === 0 ? "find text not found" : `find text is ambiguous (${count} matches)` });
        continue;
      }
      this.files.set(edit.path, content.replace(edit.find, edit.replace));
      applied.push(edit);
    }
    return { ok: failed.length === 0 && applied.length > 0, applied, failed };
  }

  async gitDiff(): Promise<string> {
    return "";
  }

  async startApp(): Promise<{ url: string; stop: () => Promise<void> }> {
    return { url: "http://memory.local", stop: async () => undefined };
  }

  async browserChecks(checks: Array<{ id: string; check: BrowserCheck }>): Promise<BrowserCheckResult[]> {
    if (this.browserHandler) return this.browserHandler(checks);
    return checks.map((entry) => ({
      id: entry.id,
      path: entry.check.path,
      passed: entry.check.expected === "pass",
      pageErrors: [],
      consoleErrors: [],
      detail: "memory browser check",
      durationMs: 1,
    }));
  }

  async cleanup(): Promise<void> {}
}
