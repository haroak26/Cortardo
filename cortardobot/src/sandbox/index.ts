import { LocalSandbox, type LocalSandboxOptions } from "./local";
import { MemorySandbox, type ExecHandler, type MemorySandboxOptions } from "./memory";
import type { Sandbox } from "./types";

export interface CreateSandboxOptions {
  mode: "dry" | "live";
  files?: Record<string, string>;
  root?: string;
  handler?: ExecHandler;
  timeoutMs?: number;
  cleanup?: boolean;
  warmDependencies?: boolean;
  allowNetwork?: boolean;
}

export function createSandbox(options: CreateSandboxOptions): Sandbox {
  if (options.mode === "dry") {
    const memoryOptions: MemorySandboxOptions = {
      files: options.files,
      root: options.root,
      handler: options.handler,
    };
    return new MemorySandbox(memoryOptions);
  }
  const localOptions: LocalSandboxOptions = {
    root: options.root,
    files: options.files,
    timeoutMs: options.timeoutMs,
    cleanupRoot: options.cleanup,
    warmDependencies: options.warmDependencies,
    allowNetwork: options.allowNetwork,
  };
  return new LocalSandbox(localOptions);
}

export { MemorySandbox, LocalSandbox };
export type { Sandbox, ExecResult, ExecOptions } from "./types";
export type { ExecHandler } from "./memory";
