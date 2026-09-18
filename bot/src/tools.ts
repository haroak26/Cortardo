/**
 * Read-only tools for swarm agents: the diff, the stored code graph and the
 * repository at the PR head through the GitHub API. Nothing here writes, runs
 * code or touches a sandbox.
 */
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import type { AgentAction, AgentObservation } from "./agent.ts";
import type { ParsedPatch } from "./patch.ts";
import type { CodegraphFileGraph, CodegraphReport } from "./types.ts";

export const READ_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read_file",
  "find_files",
  "search_code",
  "get_impact",
  "read_diff",
  "finish",
]);

export interface ReadToolContext {
  fullName: string;
  headSha: string;
  patches: Map<string, ParsedPatch>;
  analyses: Map<string, FileAnalysis>;
  report: CodegraphReport;
  /** All indexed repository paths (for find_files). */
  repoFiles: string[];
  /** Cached head content reader. */
  readFile: (path: string) => Promise<string | undefined>;
  /** Gateway code search; absent when disabled or unavailable. */
  searchCode?: (query: string) => Promise<Array<{ path: string; fragments: string[] }>>;
  signal?: AbortSignal;
}

function asString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function asNumber(args: Record<string, unknown>, key: string): number | undefined {
  const value = args[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
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

function observation(tool: string, ok: boolean, summary: string, detail: string): AgentObservation {
  return { tool, ok, summary, detail: truncate(detail, 4_000) };
}

function graphFor(ctx: ReadToolContext, path: string): CodegraphFileGraph | undefined {
  return ctx.report.files.find((file) => file.path === path);
}

function renderDiff(parsed: ParsedPatch, maxChars: number): string {
  const lines: string[] = [];
  for (const hunk of parsed.hunks) {
    lines.push(hunk.header);
    for (const line of hunk.lines) {
      const gutter = line.type === "+" ? (line.newLine ?? "") : line.type === "-" ? (line.oldLine ?? "") : "";
      lines.push(`${line.type === "+" ? ">" : line.type} ${gutter}| ${line.text}`);
    }
  }
  return truncate(lines.join("\n"), maxChars);
}

export async function executeReadTool(action: AgentAction, ctx: ReadToolContext): Promise<AgentObservation> {
  const args = action.args ?? {};
  switch (action.tool) {
    case "read_file": {
      const path = asString(args, "path");
      if (!path) return observation(action.tool, false, "path required", "read_file requires args.path");
      const content = await ctx.readFile(path).catch(() => undefined);
      if (content === undefined) return observation(action.tool, false, `not found: ${path}`, `read_file could not read ${path} at ${ctx.headSha.slice(0, 8)}`);
      const lines = content.split("\n");
      const start = Math.max(1, asNumber(args, "start") ?? 1);
      const end = Math.min(lines.length, asNumber(args, "end") ?? lines.length);
      const slice = lines.slice(start - 1, end).map((line, index) => `${start + index}| ${line}`).join("\n");
      const clipped = truncate(slice, 12_000);
      const hint =
        clipped.length < slice.length
          ? `\n\n(read_file output was truncated; call read_file again with start and end to read a specific window, e.g. start ${start} end ${Math.min(end, start + 120)})`
          : "";
      return observation(action.tool, true, `read ${path} (${lines.length} lines)`, `${clipped}${hint}`);
    }

    case "find_files": {
      const glob = asString(args, "glob") ?? "**/*";
      const regex = globToRegExp(glob);
      const matches = ctx.repoFiles.filter((path) => regex.test(path));
      return observation(action.tool, true, `${matches.length} match(es) for ${glob}`, matches.slice(0, 120).join("\n") || "(no matches)");
    }

    case "search_code": {
      const query = asString(args, "query");
      if (!query) return observation(action.tool, false, "query required", "search_code requires args.query");
      if (ctx.searchCode) {
        try {
          const matches = await ctx.searchCode(query);
          if (matches.length > 0) {
            const detail = matches
              .map((match) => `## ${match.path}\n${match.fragments.map((fragment) => truncate(fragment, 400)).join("\n---\n")}`)
              .join("\n\n");
            return observation(
              action.tool,
              true,
              `${matches.length} file(s) contain ${query} (default-branch index)`,
              `NOTE: GitHub code search indexes the repository's default branch, not this PR's head. Treat these matches as a pointer and verify the exact text with read_file/read_diff before relying on it.\n\n${detail}`,
            );
          }
          return observation(action.tool, true, `no indexed match for ${query}`, "(the repository search returned no matches)");
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return observation(action.tool, false, `repository search unavailable`, `${message}. Fall back to read_file on the files named in the graph evidence.`);
        }
      }
      const needle = query.toLowerCase();
      const hits: string[] = [];
      for (const path of ctx.report.files.map((file) => file.path)) {
        const content = await ctx.readFile(path).catch(() => undefined);
        if (!content) continue;
        content.split("\n").forEach((line, index) => {
          if (hits.length < 20 && line.toLowerCase().includes(needle)) hits.push(`${path}:${index + 1}: ${line.trim().slice(0, 200)}`);
        });
        if (hits.length >= 20) break;
      }
      return observation(action.tool, true, `${hits.length} match(es) in the diff`, hits.join("\n") || "(no matches in the changed files)");
    }

    case "get_impact": {
      const path = asString(args, "path");
      if (!path) return observation(action.tool, false, "path required", "get_impact requires args.path");
      const graph = graphFor(ctx, path);
      const analysis = ctx.analyses.get(path);
      const lines: string[] = [];
      if (analysis) {
        lines.push(
          `symbols: ${analysis.symbols
            .slice(0, 20)
            .map((symbol) => `${symbol.qualifiedName}:${symbol.line}-${symbol.endLine}`)
            .join(", ")}`,
        );
      }
      if (graph) {
        if (graph.callers.length > 0) lines.push(`callers outside the diff: ${graph.callers.map((caller) => `${caller.file}#${caller.symbol} → ${caller.via}`).join(", ")}`);
        if (graph.importedBy.length > 0) lines.push(`imported by: ${graph.importedBy.join(", ")}`);
        if (graph.callees.length > 0) lines.push(`calls into: ${graph.callees.map((callee) => `${callee.file}#${callee.symbol}`).join(", ")}`);
        if (graph.tests.length > 0) lines.push(`likely tests: ${graph.tests.join(", ")}`);
      }
      return observation(action.tool, true, `impact for ${path}`, lines.join("\n") || "(no graph edges found for this file)");
    }

    case "read_diff": {
      const path = asString(args, "path");
      if (!path) return observation(action.tool, false, "path required", "read_diff requires args.path");
      const parsed = ctx.patches.get(path);
      if (!parsed || (parsed.added.size === 0 && parsed.removed.length === 0)) {
        return observation(action.tool, false, `no textual diff for ${path}`, "This file has no patch (binary or too large); rely on read_file.");
      }
      return observation(action.tool, true, `diff for ${path}`, renderDiff(parsed, 8_000));
    }

    case "finish": {
      const summary = asString(args, "summary") ?? "finished";
      return observation(action.tool, true, "finished", summary);
    }

    default:
      return observation(
        action.tool,
        false,
        `unknown tool: ${action.tool}`,
        `Allowed tools: ${[...READ_TOOL_NAMES].join(", ")}.`,
      );
  }
}
