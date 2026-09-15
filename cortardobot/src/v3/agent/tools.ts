import type { Candidate, ContextPack, PRContext, ProofResult, RepairEdit, ToolCall, ToolName, ToolObservation } from "../types";
import type { RepoProfile, Sandbox } from "../sandbox";
import { hashContent, truncate, type Logger } from "../util";
import { assessEdits } from "../safety";
import { renderNumberedFile, unifiedDiffFromEdits } from "../patch";

export interface ToolContext {
  sandbox: Sandbox;
  profile: RepoProfile;
  candidate: Candidate;
  context: PRContext;
  pack: ContextPack;
  logger: Logger;
  probeDir: string;
  /** Engine-owned authoritative reproduction (two-run confirmed). */
  runReproduction: () => Promise<ProofResult>;
  recordAppliedEdits: (edits: RepairEdit[]) => void;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function observation(tool: ToolName, ok: boolean, summary: string, detail: string, started: number): ToolObservation {
  return { tool, ok, summary, detail: detail.slice(0, 6_000), durationMs: Date.now() - started };
}

async function safeRead(sandbox: Sandbox, path: string): Promise<string | undefined> {
  try {
    return await sandbox.read(path);
  } catch {
    return undefined;
  }
}

function numberedSlice(content: string, start = 1, end?: number): string {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const from = Math.max(1, start);
  const to = Math.min(lines.length, end ?? start + 399);
  const slice = lines.slice(from - 1, to).join("\n");
  return renderNumberedFile(slice, from);
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, ".");
  return new RegExp(`^${pattern}$`);
}

async function exec(
  ctx: ToolContext,
  command: string,
  timeoutMs = 60_000,
): Promise<{ exitCode: number; output: string; timedOut: boolean; durationMs: number }> {
  const result = await ctx.sandbox.exec(command, { cwd: ctx.sandbox.root, timeoutMs, allowFailure: true });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout}\n${result.stderr}`.trim(),
    timedOut: result.timedOut,
    durationMs: result.durationMs,
  };
}

const TOOL_MAX_RESULTS = 80;

/**
 * Executes a single tool call inside the sandbox. Tools are constructed by the
 * engine — the model only supplies quoted arguments, never raw shell.
 */
export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolObservation> {
  const started = Date.now();
  const args = call.args ?? {};
  const asString = (key: string): string | undefined => (typeof args[key] === "string" ? (args[key] as string) : undefined);
  const asNumber = (key: string): number | undefined => (typeof args[key] === "number" ? (args[key] as number) : undefined);

  try {
    switch (call.tool) {
      case "read_file": {
        const path = asString("path");
        if (!path) return observation(call.tool, false, "missing path", "read_file requires args.path", started);
        const content = await safeRead(ctx.sandbox, path);
        if (content === undefined) return observation(call.tool, false, `${path} not found`, `No file exists at ${path}.`, started);
        const start = asNumber("start") ?? 1;
        const end = asNumber("end");
        const total = content.split("\n").length;
        return observation(call.tool, true, `${path} (${total} lines)`, numberedSlice(content, start, end), started);
      }

      case "list_dir": {
        const dir = asString("path") ?? ".";
        const files = await ctx.sandbox.list(dir === "." ? ctx.sandbox.root : dir);
        const filtered = files.slice(0, 300);
        return observation(call.tool, true, `${filtered.length} file(s) under ${dir}`, filtered.join("\n"), started);
      }

      case "find_files": {
        const glob = asString("glob") ?? "**/*";
        const files = await ctx.sandbox.list(ctx.sandbox.root);
        const regex = globToRegExp(glob);
        const matches = files.filter((file) => regex.test(file)).slice(0, 200);
        return observation(call.tool, true, `${matches.length} match(es) for ${glob}`, matches.join("\n"), started);
      }

      case "search_code": {
        const pattern = asString("pattern");
        if (!pattern) return observation(call.tool, false, "missing pattern", "search_code requires args.pattern", started);
        const path = asString("path") ?? ".";
        const rg = `rg -n --no-heading --color never --max-count ${TOOL_MAX_RESULTS} -e ${shellQuote(pattern)} ${shellQuote(path)} 2>/dev/null | head -${TOOL_MAX_RESULTS}`;
        const grep = `grep -rn --color never -e ${shellQuote(pattern)} ${shellQuote(path)} 2>/dev/null | head -${TOOL_MAX_RESULTS}`;
        const result = await exec(ctx, `if command -v rg >/dev/null 2>&1; then ${rg}; else ${grep}; fi`, 60_000);
        return observation(call.tool, true, result.output ? `matches for ${pattern}` : `no matches for ${pattern}`, result.output || "(no matches)", started);
      }

      case "get_symbols": {
        const path = asString("path") ?? ctx.candidate.file ?? "";
        const content = path ? await safeRead(ctx.sandbox, path) : undefined;
        if (!content) return observation(call.tool, false, `${path || "file"} not found`, "get_symbols needs a readable file.", started);
        const symbols = new Set<string>();
        for (const match of content.matchAll(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) symbols.add(`function ${match[1]}`);
        for (const match of content.matchAll(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) symbols.add(`const ${match[1]}`);
        for (const match of content.matchAll(/(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g)) symbols.add(`class ${match[1]}`);
        return observation(call.tool, true, `${symbols.size} symbol(s) in ${path}`, [...symbols].join("\n"), started);
      }

      case "find_references": {
        const symbol = asString("symbol");
        if (!symbol) return observation(call.tool, false, "missing symbol", "find_references requires args.symbol", started);
        const path = asString("path") ?? ".";
        const result = await exec(ctx, `rg -n --no-heading --color never -w ${shellQuote(symbol)} ${shellQuote(path)} 2>/dev/null | head -${TOOL_MAX_RESULTS}`, 60_000);
        return observation(call.tool, true, result.output ? `references to ${symbol}` : `no references to ${symbol}`, result.output || "(no matches)", started);
      }

      case "get_tests_for": {
        const path = asString("path") ?? ctx.candidate.file ?? "";
        const base = path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
        const candidates = ctx.context.tests.filter((test) => {
          const testBase = test.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "";
          return testBase === base || testBase.startsWith(`${base}.`) || testBase.startsWith(`${base}-`);
        });
        const imported = base
          ? await exec(ctx, `rg -l --color never ${shellQuote(`${base}.`)} --glob ${shellQuote("*.{test,spec}.{ts,tsx,js,jsx}")} . 2>/dev/null | head -20`, 60_000)
          : { output: "", exitCode: 0, timedOut: false, durationMs: 0 };
        const all = [...new Set([...candidates, ...imported.output.split("\n").map((line) => line.trim()).filter(Boolean)])];
        return observation(call.tool, true, `${all.length} test file(s)`, all.join("\n") || "(none found)", started);
      }

      case "read_test": {
        const path = asString("path");
        if (!path) return observation(call.tool, false, "missing path", "read_test requires args.path", started);
        const content = await safeRead(ctx.sandbox, path);
        if (content === undefined) return observation(call.tool, false, `${path} not found`, `No test file exists at ${path}.`, started);
        return observation(call.tool, true, `${path} (${content.split("\n").length} lines)`, numberedSlice(content, asNumber("start") ?? 1, asNumber("end")), started);
      }

      case "run_test_file": {
        const path = asString("path");
        const command = path && ctx.profile.testSingle ? ctx.profile.testSingle(path) : ctx.profile.testCommand;
        if (!command) return observation(call.tool, false, "no test command", "Repository has no runnable test command.", started);
        const result = await exec(ctx, command, 180_000);
        const ok = result.exitCode === 0 && !result.timedOut;
        return observation(call.tool, ok, ok ? `tests passed: ${command}` : `tests failed (exit ${result.exitCode})`, truncate(result.output, 4_000), started);
      }

      case "run_typecheck": {
        if (!ctx.profile.typecheckCommand) return observation(call.tool, false, "no typecheck command", "Repository has no typecheck script.", started);
        const result = await exec(ctx, ctx.profile.typecheckCommand, 180_000);
        const ok = result.exitCode === 0 && !result.timedOut;
        return observation(call.tool, ok, ok ? "typecheck passed" : `typecheck failed (exit ${result.exitCode})`, truncate(result.output, 4_000), started);
      }

      case "run_build": {
        if (!ctx.profile.buildCommand) return observation(call.tool, false, "no build command", "Repository has no build script.", started);
        const result = await exec(ctx, ctx.profile.buildCommand, 300_000);
        const ok = result.exitCode === 0 && !result.timedOut;
        return observation(call.tool, ok, ok ? "build passed" : `build failed (exit ${result.exitCode})`, truncate(result.output, 4_000), started);
      }

      case "apply_edit": {
        const editsInput = args.edits;
        if (!Array.isArray(editsInput) || editsInput.length === 0) {
          return observation(call.tool, false, "missing edits", "apply_edit requires args.edits: [{path, find, replace}]", started);
        }
        const edits: RepairEdit[] = editsInput.map((entry) => {
          const record = entry as Record<string, unknown>;
          return { path: String(record.path ?? ""), find: String(record.find ?? ""), replace: String(record.replace ?? "") };
        });
        if (edits.some((edit) => !edit.path || !edit.find)) {
          return observation(call.tool, false, "invalid edits", "Every edit needs a non-empty path and find string.", started);
        }
        const safety = assessEdits(edits);
        if (!safety.ok) return observation(call.tool, false, `rejected: ${safety.reason}`, safety.reason, started);

        const before = new Map<string, string | undefined>();
        for (const edit of edits) if (!before.has(edit.path)) before.set(edit.path, await safeRead(ctx.sandbox, edit.path));

        const apply = await ctx.sandbox.applyEdits(edits);
        if (!apply.ok) {
          // A partial apply must not leave the working tree half-edited.
          for (const edit of apply.applied) {
            const prior = before.get(edit.path);
            if (prior !== undefined) await ctx.sandbox.write(edit.path, prior).catch(() => undefined);
          }
          return observation(
            call.tool,
            false,
            `apply failed: ${apply.failed.map((entry) => entry.reason).join("; ") || "unknown"}`,
            apply.failed.map((entry) => `${entry.edit.path}: ${entry.reason}`).join("\n") || "No edits matched the file.",
            started,
          );
        }

        const changedPaths: string[] = [];
        const noops: string[] = [];
        for (const edit of apply.applied) {
          const prior = before.get(edit.path);
          const after = await safeRead(ctx.sandbox, edit.path);
          if (after === undefined) {
            return observation(call.tool, false, `post-edit read failed for ${edit.path}`, "The edited file could not be read back.", started);
          }
          if (prior !== undefined && hashContent(prior) === hashContent(after)) {
            noops.push(edit.path);
            continue;
          }
          if (edit.find !== edit.replace && after.includes(edit.find)) {
            return observation(call.tool, false, `postcondition failed for ${edit.path}`, "The find text is still present after applying the edit.", started);
          }
          changedPaths.push(edit.path);
        }
        if (changedPaths.length === 0) {
          return observation(call.tool, false, `no-op edit rejected (${noops.join(", ") || "no change"})`, "The edit produced identical file content; produce a different fix.", started);
        }
        ctx.recordAppliedEdits(apply.applied);
        const diffs = apply.applied
          .map((edit) => {
            const prior = before.get(edit.path);
            return prior !== undefined ? unifiedDiffFromEdits(edit.path, prior, [edit]) : `${edit.path}: changed`;
          })
          .join("\n");
        return observation(call.tool, true, `applied ${changedPaths.length} edit(s) to ${changedPaths.join(", ")}`, truncate(diffs, 4_000), started);
      }

      case "git_diff": {
        const diff = await ctx.sandbox.gitDiff();
        return observation(call.tool, true, `working tree diff (${diff.length} chars)`, truncate(diff, 5_000) || "(clean)", started);
      }

      case "write_probe": {
        const name = asString("name");
        const content = asString("content");
        if (!name || !/^[\w.-]{1,64}$/.test(name) || !/\.(test|spec)\.[cm]?[jt]sx?$/.test(name)) {
          return observation(call.tool, false, "invalid probe name", "name must look like foo.test.ts", started);
        }
        if (!content || content.length < 20) {
          return observation(call.tool, false, "invalid probe content", "Provide a complete test file body.", started);
        }
        await ctx.sandbox.write(`${ctx.probeDir}/${name}`, content);
        return observation(call.tool, true, `wrote ${ctx.probeDir}/${name}`, truncate(content, 1_500), started);
      }

      case "run_probe": {
        const name = asString("name");
        if (!name || !/^[\w.-]{1,64}$/.test(name)) {
          return observation(call.tool, false, "invalid probe name", "run_probe requires args.name", started);
        }
        const path = `${ctx.probeDir}/${name}`;
        if (!(await ctx.sandbox.exists(path))) {
          return observation(call.tool, false, `${name} not found`, `Write the probe first with write_probe.`, started);
        }
        const command = ctx.profile.testSingle
          ? ctx.profile.testSingle(path)
          : `npx vitest run --reporter=basic --passWithNoTests ${shellQuote(path)} 2>&1 | tail -120`;
        const result = await exec(ctx, command, 180_000);
        const ok = result.exitCode === 0 && !result.timedOut;
        return observation(call.tool, ok, ok ? `probe passed: ${name}` : `probe failed (exit ${result.exitCode})`, truncate(result.output, 4_000), started);
      }

      case "run_reproduction": {
        const proof = await ctx.runReproduction();
        const ok = proof.status === "disproven";
        return observation(call.tool, ok, `reproduction ${proof.status}`, truncate(`${proof.explanation}\n${proof.reproduction}`, 2_500), started);
      }

      case "finish": {
        const summary = asString("summary") ?? "Agent finished without an edit.";
        return observation(call.tool, true, "finished", summary, started);
      }

      default: {
        const unknown = call.tool as string;
        return observation(call.tool, false, `unknown tool: ${unknown}`, `Available tools: read_file, list_dir, find_files, search_code, get_symbols, find_references, get_tests_for, read_test, run_test_file, run_typecheck, run_build, apply_edit, git_diff, write_probe, run_probe, run_reproduction, finish`, started);
      }
    }
  } catch (error) {
    return observation(call.tool, false, `tool error: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack ?? error.message : String(error), started);
  }
}
