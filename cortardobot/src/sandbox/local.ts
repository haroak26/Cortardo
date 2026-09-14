import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PatchApplyResult } from "../util/diff";
import { applyFilePatch, applyUnifiedDiff, parseUnifiedDiff } from "../util/diff";
import { assessCommand } from "./safety";
import { commandResult, type ExecOptions, type ExecResult, type Sandbox } from "./types";

export interface LocalSandboxOptions {
  root?: string;
  files?: Record<string, string>;
  timeoutMs?: number;
  cleanupRoot?: boolean;
  warmDependencies?: boolean;
  allowNetwork?: boolean;
}

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "SHELL",
  "TERM",
  "USER",
  "LOGNAME",
];

export class LocalSandbox implements Sandbox {
  readonly id: string;
  readonly root: string;
  readonly dryRun = false;
  toolCalls = 0;
  private readonly initialFiles: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly cleanupRoot?: boolean;
  private readonly warmDependencies: boolean;
  private readonly allowNetwork: boolean;
  private shouldCleanup = false;

  constructor(options: LocalSandboxOptions = {}) {
    this.root = options.root ?? path.join(os.tmpdir(), `cortado-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    this.id = path.basename(this.root);
    this.initialFiles = options.files ?? {};
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.cleanupRoot = options.cleanupRoot;
    this.warmDependencies = options.warmDependencies ?? false;
    this.allowNetwork = options.allowNetwork ?? false;
  }

  private resolve(filePath: string): string {
    const normalized = filePath.replace(/^\/+/, "");
    const resolved = path.resolve(this.root, normalized);
    if (resolved !== this.root && !resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error(`path escapes sandbox root: ${filePath}`);
    }
    return resolved;
  }

  private safeEnv(extra?: Record<string, string>): Record<string, string> {
    const env: Record<string, string> = {};
    for (const key of SAFE_ENV_KEYS) {
      const value = process.env[key];
      if (value !== undefined) env[key] = value;
    }
    env.CI = "1";
    env.NO_COLOR = "1";
    return { ...env, ...extra };
  }

  async setup(): Promise<void> {
    let existed = true;
    try {
      await fs.access(this.root);
    } catch {
      existed = false;
    }
    this.shouldCleanup = this.cleanupRoot ?? !existed;
    await fs.mkdir(this.root, { recursive: true });
    for (const [filePath, content] of Object.entries(this.initialFiles)) {
      const target = this.resolve(filePath);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    }
  }

  async warm(): Promise<void> {
    if (!this.warmDependencies || !this.allowNetwork) return;
    try {
      await fs.access(path.join(this.root, "package.json"));
    } catch {
      return;
    }
    try {
      await fs.access(path.join(this.root, "node_modules"));
      return;
    } catch {
      // dependencies are not cached yet
    }
    await this.exec("npm ci --prefer-offline --no-audit --no-fund --ignore-scripts", {
      timeoutMs: this.timeoutMs,
    });
  }

  async read(filePath: string): Promise<string> {
    return fs.readFile(this.resolve(filePath), "utf8");
  }

  async write(filePath: string, content: string): Promise<void> {
    const target = this.resolve(filePath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
  }

  async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(filePath));
      return true;
    } catch {
      return false;
    }
  }

  async list(dir = ""): Promise<string[]> {
    const base = this.resolve(dir);
    const startRelative = dir.replace(/^\/+|\/+$/g, "");
    const entries: string[] = [];
    const walk = async (current: string, relative: string) => {
      const items = await fs.readdir(current, { withFileTypes: true });
      for (const item of items) {
        const childRelative = relative ? `${relative}/${item.name}` : item.name;
        if (item.isDirectory()) {
          if (item.name === "node_modules" || item.name === ".git") continue;
          await walk(path.join(current, item.name), childRelative);
        } else {
          entries.push(childRelative);
        }
      }
    };
    await walk(base, startRelative);
    return entries;
  }

  async exec(command: string, options: ExecOptions = {}): Promise<ExecResult> {
    this.toolCalls++;
    const safety = assessCommand(command);
    if (!safety.allowed) {
      return commandResult(command, { exitCode: 126, stderr: `blocked by sandbox policy: ${safety.reason}` });
    }
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const cwd = options.cwd ? this.resolve(options.cwd) : this.root;
    const started = Date.now();
    return new Promise<ExecResult>((resolve) => {
      const child = spawn(command, {
        shell: "/bin/bash",
        cwd,
        env: this.safeEnv(options.env),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        if (stdout.length > 200_000) stdout = stdout.slice(-200_000);
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        if (stderr.length > 200_000) stderr = stderr.slice(-200_000);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          command,
          exitCode: code ?? (timedOut ? 124 : 1),
          stdout,
          stderr,
          durationMs: Date.now() - started,
          timedOut,
        });
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        resolve({
          command,
          exitCode: 127,
          stdout,
          stderr: `${stderr}${error.message}`,
          durationMs: Date.now() - started,
          timedOut,
        });
      });
    });
  }

  async applyPatch(patch: string): Promise<PatchApplyResult> {
    this.toolCalls++;
    const parsed = parseUnifiedDiff(patch);
    const results: PatchApplyResult["files"] = [];
    for (const filePatch of parsed) {
      try {
        const isNewFile = filePatch.oldPath === "/dev/null";
        const isDeletedFile = filePatch.newPath === "/dev/null";
        let content = "";
        if (!isNewFile) {
          content = await this.read(filePatch.path);
        }
        const applied = applyFilePatch(content, filePatch);
        if (applied.ok && applied.content !== undefined) {
          if (isDeletedFile) {
            await fs.rm(this.resolve(filePatch.path), { force: true });
          } else {
            await this.write(filePatch.path, applied.content);
          }
          results.push({
            path: filePatch.path,
            applied: true,
            hunksApplied: applied.hunksApplied,
            hunksTotal: applied.hunksTotal,
          });
        } else {
          results.push({
            path: filePatch.path,
            applied: false,
            reason: applied.reason,
            hunksApplied: applied.hunksApplied,
            hunksTotal: applied.hunksTotal,
          });
        }
      } catch (error) {
        results.push({
          path: filePatch.path,
          applied: false,
          reason: error instanceof Error ? error.message : String(error),
          hunksApplied: 0,
          hunksTotal: filePatch.hunks.length,
        });
      }
    }
    const ok = results.length > 0 && results.every((file) => file.applied);
    return { ok, files: results, reason: ok ? undefined : "one or more files failed to apply" };
  }

  async snapshot(): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    for (const filePath of await this.list()) {
      try {
        files[filePath] = await this.read(filePath);
      } catch {
        // skip unreadable files (binary, etc.)
      }
    }
    return files;
  }

  async cleanup(): Promise<void> {
    if (!this.shouldCleanup) return;
    await fs.rm(this.root, { recursive: true, force: true });
  }
}

export function applyPatchToRecord(
  patch: string,
  files: Record<string, string>,
): PatchApplyResult {
  return applyUnifiedDiff(patch, files);
}
