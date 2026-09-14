import type { PatchApplyResult } from "../util/diff";

export interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  allowFailure?: boolean;
}

export interface ExecResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

export interface SandboxSetupFile {
  path: string;
  content: string;
}

export interface SandboxOptions {
  id?: string;
  root?: string;
  files?: Record<string, string>;
  timeoutMs?: number;
}

export interface Sandbox {
  readonly id: string;
  readonly root: string;
  readonly dryRun: boolean;
  setup(): Promise<void>;
  warm(): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(dir?: string): Promise<string[]>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  applyPatch(patch: string): Promise<PatchApplyResult>;
  snapshot(): Promise<Record<string, string>>;
  cleanup(): Promise<void>;
  readonly toolCalls: number;
}

export function commandResult(
  command: string,
  partial: Partial<Omit<ExecResult, "command">> = {},
): ExecResult {
  return {
    command,
    exitCode: partial.exitCode ?? 0,
    stdout: partial.stdout ?? "",
    stderr: partial.stderr ?? "",
    durationMs: partial.durationMs ?? 1,
    timedOut: partial.timedOut ?? false,
  };
}
