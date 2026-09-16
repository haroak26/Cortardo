/**
 * In-memory sandbox used by the deterministic tests. It hosts a small file
 * system and delegates command execution to a caller-supplied handler so
 * tests can simulate probe failures, gates and repair runs without E2B.
 */
import type { ExecResult, RepoProfile, Sandbox } from "./types";
import { isTestPath } from "./patch";

export interface MemorySandboxOptions {
  files?: Record<string, string>;
  root?: string;
  profile?: Partial<RepoProfile>;
  exec?: (command: string, sandbox: MemorySandbox) => Promise<ExecResult> | ExecResult;
}

export class MemorySandbox implements Sandbox {
  readonly id = "memory";
  readonly root: string;
  private readonly files = new Map<string, string>();
  private readonly profileOverrides: Partial<RepoProfile>;
  private readonly execHandler?: MemorySandboxOptions["exec"];
  readonly commands: string[] = [];
  appStarts = 0;

  constructor(options: MemorySandboxOptions = {}) {
    this.root = options.root ?? "/repo";
    this.profileOverrides = options.profile ?? {};
    this.execHandler = options.exec;
    for (const [path, content] of Object.entries(options.files ?? {})) this.files.set(path, content);
  }

  private normalize(path: string): string {
    if (path.startsWith(this.root)) return path.slice(this.root.length).replace(/^\//, "");
    return path.replace(/^\//, "");
  }

  async prepare(): Promise<void> {
    // nothing to clone in memory
  }

  async install(): Promise<void> {
    // dependencies are whatever the test provided
  }

  async profile(): Promise<RepoProfile> {
    const testFiles = [...this.files.keys()].filter((path) => isTestPath(path));
    return {
      packageManager: "npm",
      installCommand: "npm ci",
      hasNodeModules: true,
      testFiles,
      scripts: {},
      ...this.profileOverrides,
    };
  }

  async exec(command: string, options: { signal?: AbortSignal } = {}): Promise<ExecResult> {
    this.commands.push(command);
    if (options.signal?.aborted) {
      return { command, exitCode: 130, stdout: "", stderr: "aborted", durationMs: 0, timedOut: true };
    }
    if (this.execHandler) {
      const result = await this.execHandler(command, this);
      return { ...result, command };
    }
    return { command, exitCode: 0, stdout: "", stderr: "", durationMs: 0, timedOut: false };
  }

  async read(path: string): Promise<string> {
    const key = this.normalize(path);
    const content = this.files.get(key);
    if (content === undefined) throw new Error(`ENOENT: ${key}`);
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(this.normalize(path), content);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(this.normalize(path));
  }

  async list(dir = this.root): Promise<string[]> {
    const prefix = this.normalize(dir).replace(/\/$/, "");
    return [...this.files.keys()].filter((path) => path.startsWith(prefix ? `${prefix}/` : ""));
  }

  async gitDiff(): Promise<string> {
    return "";
  }

  async startApp(): Promise<{ url: string; stop: () => Promise<void> }> {
    this.appStarts += 1;
    return { url: "http://127.0.0.1:4173", stop: async () => undefined };
  }

  async cleanup(): Promise<void> {
    // nothing to tear down
  }

  /** Test helper: current file map. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files);
  }
}
