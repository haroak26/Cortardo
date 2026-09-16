/**
 * One tool registry for every agent phase. The phase decides which tools are
 * allowed; the implementation never changes.
 */
import type { RepairEdit, Sandbox } from "../types";
import type { GraphIndex } from "../context/graph";
import type { PRContext } from "../context/pack";
import { probeCommand } from "../artifact";
import { truncate, type Logger } from "../util";

export { probeCommand };

export const READ_TOOLS = [
  "read_file",
  "list_dir",
  "find_files",
  "search_code",
  "read_doc",
  "get_symbols",
  "find_references",
  "get_impact",
  "search_strings",
  "get_tests_for",
  "read_test",
  "read_app_log",
] as const;

export const INVESTIGATOR_TOOLS: ReadonlySet<string> = new Set([...READ_TOOLS, "write_probe", "run_probe", "start_app", "finish"]);
export const RESEARCHER_TOOLS: ReadonlySet<string> = new Set([...READ_TOOLS, "finish"]);
export const ENGINEER_TOOLS: ReadonlySet<string> = new Set([
  ...READ_TOOLS,
  "write_probe",
  "run_probe",
  "run_command",
  "write_file",
  "edit_file",
  "git_diff",
  "start_app",
  "finish",
]);
export const REVIEWER_TOOLS: ReadonlySet<string> = new Set([...READ_TOOLS, "git_diff", "finish"]);

export interface ToolObservation {
  tool: string;
  ok: boolean;
  summary: string;
  detail: string;
  durationMs: number;
}

export interface RecordedProbe {
  name: string;
  content: string;
  command: string;
  passed: boolean;
  output: string;
}

export interface ToolContext {
  sandbox: Sandbox;
  graph: GraphIndex;
  context: PRContext;
  profile: PRContext["profile"];
  probeDir: string;
  phase: string;
  logger: Logger;
  signal?: AbortSignal;
  recordProbe?: (probe: RecordedProbe) => void;
  /** Called before a file is mutated so the engine can roll back attempts. */
  snapshot?: (path: string, content: string) => void;
  recordEdit?: (edit: RepairEdit) => void;
  stopApp?: () => Promise<void>;
}

export interface ToolCall {
  tool: string;
  args: Record<string, unknown>;
}

function asString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function observation(tool: string, ok: boolean, summary: string, detail: string, started: number): ToolObservation {
  return { tool, ok, summary, detail: truncate(detail, 4_000), durationMs: Date.now() - started };
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*\//g, "(?:.*/)?")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`);
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolObservation> {
  const started = Date.now();
  const args = call.args ?? {};
  try {
    switch (call.tool) {
      case "read_file": {
        const path = asString(args, "path");
        if (!path) return observation(call.tool, false, "path required", "read_file requires args.path", started);
        const content = await ctx.sandbox.read(path).catch(() => undefined);
        if (content === undefined) return observation(call.tool, false, `not found: ${path}`, `read_file could not read ${path}`, started);
        const lines = content.split("\n");
        const start = Math.max(1, asNumber(args, "start") ?? 1);
        const end = Math.min(lines.length, asNumber(args, "end") ?? lines.length);
        const slice = lines.slice(start - 1, end).map((line, index) => `${start + index}| ${line}`).join("\n");
        return observation(call.tool, true, `read ${path} (${lines.length} lines)`, truncate(slice, 12_000), started);
      }

      case "list_dir": {
        const dir = asString(args, "path") ?? ctx.sandbox.root;
        const files = await ctx.sandbox.list(dir);
        return observation(call.tool, true, `${files.length} file(s) under ${dir}`, files.slice(0, 300).join("\n"), started);
      }

      case "find_files": {
        const glob = asString(args, "glob") ?? "**/*";
        const regex = globToRegExp(glob);
        const files = (await ctx.sandbox.list()).filter((path) => regex.test(path));
        return observation(call.tool, true, `${files.length} match(es) for ${glob}`, files.slice(0, 200).join("\n"), started);
      }

      case "search_code": {
        const pattern = asString(args, "pattern");
        if (!pattern) return observation(call.tool, false, "pattern required", "search_code requires args.pattern", started);
        const scope = asString(args, "path") ?? ".";
        const escaped = pattern.replace(/[\\"]/g, "\\$&");
        const result = await ctx.sandbox.exec(
          `grep -rn -I -m 3 --exclude-dir=node_modules --exclude-dir=.git -E "${escaped}" ${scope === "." ? "." : `'${scope}'`} | head -80`,
          { timeoutMs: 60_000, allowFailure: true, signal: ctx.signal },
        );
        return observation(call.tool, true, `${pattern}: ${result.stdout.split("\n").filter(Boolean).length} hit(s)`, result.stdout || "(no matches)", started);
      }

      case "read_doc": {
        const path = asString(args, "path");
        const docs = ctx.graph.knowledge;
        const doc = path ? docs.find((entry) => entry.path === path) : docs[0];
        if (!doc) return observation(call.tool, false, "no docs available", "The repository knowledge index has no entry for that path.", started);
        return observation(call.tool, true, `doc ${doc.path}`, truncate(doc.content, 8_000), started);
      }

      case "get_symbols": {
        const query = asString(args, "query") ?? asString(args, "path") ?? "";
        const symbols = ctx.graph.searchSymbols(query, 30);
        const detail = symbols.map((symbol) => `${symbol.kind} ${symbol.qualifiedName} (${symbol.fileId}:${symbol.line}) — ${symbol.signature}`).join("\n");
        return observation(call.tool, true, `${symbols.length} symbol(s) for ${query}`, detail || "(none)", started);
      }

      case "find_references": {
        const name = asString(args, "name");
        if (!name) return observation(call.tool, false, "name required", "find_references requires args.name", started);
        const symbols = ctx.graph.searchSymbols(name, 5);
        const lines: string[] = [];
        for (const symbol of symbols) {
          for (const ref of ctx.graph.callersOf(symbol.id, 2, 20)) {
            lines.push(`${ref.symbol.qualifiedName} (${ref.symbol.fileId}:${ref.symbol.line}) → ${symbol.qualifiedName} (depth ${ref.depth})`);
          }
        }
        return observation(call.tool, true, `${lines.length} reference(s) to ${name}`, lines.join("\n") || "(none found in the code graph)", started);
      }

      case "get_impact": {
        const path = asString(args, "path");
        if (!path) return observation(call.tool, false, "path required", "get_impact requires args.path", started);
        const slice = ctx.graph.impact([path], ctx.profile.testFiles ?? []);
        const lines = [
          ...slice.callers.map((ref) => `caller: ${ref.symbol.qualifiedName} (${ref.symbol.fileId}:${ref.symbol.line})`),
          ...slice.stringConsumers.map((consumer) => `string "${consumer.value}" at ${consumer.path}:${consumer.line}`),
          ...slice.tests.map((test) => `test: ${test}`),
          ...slice.importers.map((importer) => `imports: ${importer}`),
        ];
        return observation(call.tool, true, `impact for ${path}`, lines.join("\n") || "(no impact edges found)", started);
      }

      case "search_strings": {
        const query = asString(args, "query");
        if (!query) return observation(call.tool, false, "query required", "search_strings requires args.query", started);
        const refs = ctx.graph.searchStrings(query, 40);
        const lines = refs.map((ref) => `"${ref.value}" at ${ref.path}:${ref.line}${ref.changed ? " (changed file)" : ""}`);
        return observation(call.tool, true, `${refs.length} string reference(s)`, lines.join("\n") || "(none)", started);
      }

      case "get_tests_for": {
        const path = asString(args, "path");
        if (!path) return observation(call.tool, false, "path required", "get_tests_for requires args.path", started);
        const tests = ctx.graph.impact([path], ctx.profile.testFiles ?? []).tests;
        return observation(call.tool, true, `${tests.length} test file(s)`, tests.join("\n") || "(no related tests found)", started);
      }

      case "read_test": {
        const path = asString(args, "path");
        if (!path) return observation(call.tool, false, "path required", "read_test requires args.path", started);
        const content = await ctx.sandbox.read(path).catch(() => undefined);
        if (content === undefined) return observation(call.tool, false, `not found: ${path}`, "read_test could not read that file", started);
        return observation(call.tool, true, `read ${path}`, truncate(content, 8_000), started);
      }

      case "write_probe": {
        const name = asString(args, "name");
        const content = asString(args, "content");
        if (!name || !/^[\w.-]{1,64}\.(mjs|cjs|js|ts|mts|py|sh)$/.test(name)) {
          return observation(call.tool, false, "invalid probe name", "name must be a simple file like repro.mjs, repro.ts, repro.py or repro.sh", started);
        }
        if (!content || content.length < 20) {
          return observation(call.tool, false, "invalid probe content", "Provide a complete runnable script.", started);
        }
        await ctx.sandbox.write(`${ctx.probeDir}/${name}`, content);
        return observation(call.tool, true, `wrote ${ctx.probeDir}/${name}`, truncate(content, 1_200), started);
      }

      case "run_probe": {
        const name = asString(args, "name");
        if (!name || !/^[\w.-]{1,64}$/.test(name)) return observation(call.tool, false, "invalid probe name", "run_probe requires args.name", started);
        const path = `${ctx.probeDir}/${name}`;
        if (!(await ctx.sandbox.exists(path))) return observation(call.tool, false, `${name} not found`, "Write the probe first with write_probe.", started);
        const content = await ctx.sandbox.read(path).catch(() => undefined);
        const command = probeCommand(`${ctx.probeDir}/${name}`, content);
        const result = await ctx.sandbox.exec(command, { cwd: ctx.sandbox.root, timeoutMs: 120_000, allowFailure: true, signal: ctx.signal });
        const output = `${result.stdout}\n${result.stderr}`.trim();
        const passed = result.exitCode === 0 && !result.timedOut;
        if (content !== undefined) {
          ctx.recordProbe?.({ name, content, command, passed, output: truncate(output, 4_000) });
        }
        return observation(call.tool, passed, passed ? `probe passed: ${name}` : `probe failed (exit ${result.exitCode})`, `${command}\n${output}`, started);
      }

      case "read_app_log": {
        const lines = asNumber(args, "lines") ?? 120;
        const count = Math.min(400, Math.max(10, lines));
        const result = await ctx.sandbox.exec(
          `tail -n ${count} /home/user/cortado/dev.log 2>/dev/null; tail -n ${count} /tmp/cortado-dev.log 2>/dev/null; true`,
          { timeoutMs: 20_000, allowFailure: true, signal: ctx.signal },
        );
        return observation(call.tool, true, "dev server log", result.stdout.trim() || "(no dev server log)", started);
      }

      case "write_file": {
        const path = asString(args, "path");
        const content = asString(args, "content");
        if (!path || content === undefined) return observation(call.tool, false, "path and content required", "write_file requires args.path and args.content", started);
        const original = await ctx.sandbox.read(path).catch(() => undefined);
        if (original !== undefined) ctx.snapshot?.(path, original);
        await ctx.sandbox.write(path, content);
        return observation(call.tool, true, `wrote ${path} (${content.split("\n").length} lines)`, "File written.", started);
      }

      case "edit_file": {
        const path = asString(args, "path");
        const find = asString(args, "find");
        const replace = args.replace;
        if (!path || !find || typeof replace !== "string") {
          return observation(call.tool, false, "path, find and replace required", "edit_file requires args.path, args.find and args.replace", started);
        }
        const content = await ctx.sandbox.read(path).catch(() => undefined);
        if (content === undefined) return observation(call.tool, false, `not found: ${path}`, "edit_file could not read that file", started);
        const count = content.split(find).length - 1;
        if (count === 0) return observation(call.tool, false, "find text not found", `edit_file: find text not found in ${path}`, started);
        if (count > 1) return observation(call.tool, false, "find text is ambiguous", `edit_file: find text matches ${count} times in ${path}`, started);
        ctx.snapshot?.(path, content);
        await ctx.sandbox.write(path, content.replace(find, replace));
        const edit: RepairEdit = { path, find, replace };
        ctx.recordEdit?.(edit);
        return observation(call.tool, true, `edited ${path}`, `Replaced ${find.length} chars with ${replace.length} chars.`, started);
      }

      case "run_command": {
        const command = asString(args, "command");
        if (!command) return observation(call.tool, false, "command required", "run_command requires args.command", started);
        const timeoutMs = typeof args.timeoutMs === "number" ? Math.min(600_000, args.timeoutMs) : 180_000;
        const result = await ctx.sandbox.exec(command, { cwd: ctx.sandbox.root, timeoutMs, allowFailure: true, signal: ctx.signal });
        const output = `${result.stdout}\n${result.stderr}`.trim();
        return observation(call.tool, result.exitCode === 0, `exit ${result.exitCode}: ${truncate(command, 80)}`, output || "(no output)", started);
      }

      case "git_diff": {
        const diff = await ctx.sandbox.gitDiff();
        return observation(call.tool, true, `working tree diff (${diff.length} chars)`, truncate(diff, 8_000) || "(clean)", started);
      }

      case "start_app": {
        const port = asNumber(args, "port") ?? 4173;
        try {
          const handle = await ctx.sandbox.startApp({ port });
          ctx.stopApp = handle.stop;
          return observation(call.tool, true, `app running at ${handle.url}`, `The dev server is up at ${handle.url}.`, started);
        } catch (error) {
          return observation(call.tool, false, "app failed to start", error instanceof Error ? error.message : String(error), started);
        }
      }

      case "finish": {
        const summary = asString(args, "summary") ?? "finished";
        return observation(call.tool, true, "finished", summary, started);
      }

      default:
        return observation(call.tool, false, `unknown tool: ${call.tool}`, `Available tools: ${[...READ_TOOLS].join(", ")}, write_probe, run_probe, run_command, write_file, edit_file, git_diff, start_app, finish`, started);
    }
  } catch (error) {
    return observation(call.tool, false, "tool error", error instanceof Error ? error.stack ?? error.message : String(error), started);
  }
}
