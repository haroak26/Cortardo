import type { PatchApplyResult } from "../util/diff";
import { applyUnifiedDiff } from "../util/diff";
import { assessCommand } from "./safety";
import { commandResult, type ExecOptions, type ExecResult, type Sandbox, type SandboxOptions } from "./types";

export type ExecHandler = (command: string, files: Record<string, string>, toolCalls: number) => ExecResult | Promise<ExecResult>;

export interface MemorySandboxOptions extends SandboxOptions {
  handler?: ExecHandler;
  defaultResult?: Partial<Omit<ExecResult, "command">>;
}

export class MemorySandbox implements Sandbox {
  readonly id: string;
  readonly root: string;
  readonly dryRun = true;
  readonly commands: string[] = [];
  toolCalls = 0;
  protected files: Record<string, string>;
  private handler?: ExecHandler;
  private defaultResult: Partial<Omit<ExecResult, "command">>;

  constructor(options: MemorySandboxOptions = {}) {
    this.id = options.id ?? "memory";
    this.root = options.root ?? "(memory)";
    this.files = { ...(options.files ?? {}) };
    this.handler = options.handler;
    this.defaultResult = options.defaultResult ?? {};
  }

  async setup(): Promise<void> {}

  async warm(): Promise<void> {}

  async read(path: string): Promise<string> {
    if (this.files[path] === undefined) throw new Error(`sandbox file not found: ${path}`);
    return this.files[path];
  }

  async write(path: string, content: string): Promise<void> {
    this.files[path] = content;
  }

  async exists(path: string): Promise<boolean> {
    return this.files[path] !== undefined;
  }

  async list(dir = ""): Promise<string[]> {
    const prefix = dir ? `${dir.replace(/\/$/, "")}/` : "";
    return Object.keys(this.files).filter((path) => path.startsWith(prefix));
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    this.toolCalls++;
    this.commands.push(command);
    const safety = assessCommand(command);
    if (!safety.allowed) {
      return commandResult(command, {
        exitCode: 126,
        stderr: `blocked by sandbox policy: ${safety.reason}`,
        ...this.defaultResult,
      });
    }
    if (this.handler) {
      const result = await this.handler(command, this.files, this.toolCalls);
      return { ...result, command };
    }
    return commandResult(command, this.defaultResult);
  }

  async applyPatch(patch: string): Promise<PatchApplyResult> {
    this.toolCalls++;
    return applyUnifiedDiff(patch, this.files);
  }

  async snapshot(): Promise<Record<string, string>> {
    return { ...this.files };
  }

  async cleanup(): Promise<void> {}
}
