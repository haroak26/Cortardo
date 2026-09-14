import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import pLimit from "p-limit";
import type { NewRepositoryCodeFile, Repository } from "@shared/schema";
import { db } from "../../db";
import { storage } from "../../storage";
import { getInstallationToken } from "../github/app";
import {
  ANALYZE_VERSION,
  buildAnalyzeResult,
  parseSourceFile,
  isSupportedCodegraphFile,
  type FileAnalysis,
  type SourceFile,
} from "./analyze";

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 180_000;
const MAX_FILES = Math.max(50, Number(process.env.CODEGRAPH_MAX_FILES) || 1200);
const MAX_FILE_BYTES = 256 * 1024;
const CONCURRENCY = Math.max(1, Number(process.env.CODEGRAPH_CONCURRENCY) || 2);

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "vendor",
  "coverage",
  ".cache",
  ".turbo",
  "__pycache__",
  ".venv",
  "venv",
  "env",
  "target",
  "Pods",
  ".idea",
  ".vscode",
]);

const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "composer.lock",
  "Cargo.lock",
  "poetry.lock",
]);

const SKIP_SUFFIXES = [".min.js", ".min.css", ".map"];

let schemaPromise: Promise<void> | null = null;

/** Idempotent DDL so first boot on a fresh database works without a migration. */
export function ensureCodegraphSchema(): Promise<void> {
  if (!schemaPromise) {
    schemaPromise = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS repository_codegraphs (
          repository_id uuid PRIMARY KEY REFERENCES repositories(id) ON DELETE CASCADE,
          commit_sha text,
          status text NOT NULL DEFAULT 'pending',
          error text,
          files jsonb NOT NULL DEFAULT '[]'::jsonb,
          connections jsonb NOT NULL DEFAULT '[]'::jsonb,
          symbols jsonb NOT NULL DEFAULT '[]'::jsonb,
          symbol_edges jsonb NOT NULL DEFAULT '[]'::jsonb,
          knowledge jsonb NOT NULL DEFAULT '[]'::jsonb,
          file_count integer NOT NULL DEFAULT 0,
          generated_at timestamp,
          updated_at timestamp NOT NULL DEFAULT now()
        )
      `);
      await db.execute(sql`ALTER TABLE repository_codegraphs ADD COLUMN IF NOT EXISTS symbols jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await db.execute(sql`ALTER TABLE repository_codegraphs ADD COLUMN IF NOT EXISTS symbol_edges jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await db.execute(sql`ALTER TABLE repository_codegraphs ADD COLUMN IF NOT EXISTS knowledge jsonb NOT NULL DEFAULT '[]'::jsonb`);
      await db.execute(
        sql`CREATE INDEX IF NOT EXISTS repository_codegraphs_status_idx ON repository_codegraphs (status)`,
      );
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS repository_code_files (
          repository_id uuid NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
          path text NOT NULL,
          content_hash text NOT NULL,
          language text NOT NULL,
          kind text NOT NULL,
          loc integer NOT NULL DEFAULT 0,
          parsed jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamp NOT NULL DEFAULT now(),
          PRIMARY KEY (repository_id, path)
        )
      `);
    })().catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }
  return schemaPromise;
}

function bytesToText(content: Buffer): string {
  return content.toString("utf8").replace(/^\uFEFF/, "");
}

async function collectFiles(rootDir: string): Promise<{ files: SourceFile[]; truncated: boolean }> {
  const files: SourceFile[] = [];
  let truncated = false;

  const walk = async (dir: string, relative: string): Promise<void> => {
    if (truncated) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

    for (const entry of entries) {
      if (truncated) return;
      if (entry.name.startsWith(".") && entry.name !== ".github") {
        if (entry.isDirectory()) continue;
      }
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path.join(dir, entry.name), relative ? `${relative}/${entry.name}` : entry.name);
        continue;
      }
      if (!entry.isFile()) continue;

      const filePath = relative ? `${relative}/${entry.name}` : entry.name;
      if (SKIP_FILES.has(entry.name)) continue;
      if (SKIP_SUFFIXES.some((suffix) => filePath.endsWith(suffix))) continue;
      if (!isSupportedCodegraphFile(filePath)) continue;

      const absolute = path.join(dir, entry.name);
      try {
        const info = await stat(absolute);
        if (info.size === 0 || info.size > MAX_FILE_BYTES) continue;
        const content = bytesToText(await readFile(absolute));
        files.push({ path: filePath, content });
      } catch {
        continue;
      }

      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
    }
  };

  await walk(rootDir, "");
  return { files, truncated };
}

async function cloneRepository(repository: Repository, directory: string): Promise<string> {
  if (!repository.installationId) {
    throw new Error("Repository is not linked to a GitHub installation");
  }
  const token = await getInstallationToken(repository.installationId);
  const cloneUrl = `https://x-access-token:${token}@github.com/${repository.fullName}.git`;

  await execFileAsync(
    "git",
    ["clone", "--depth", "1", "--no-tags", "--single-branch", cloneUrl, directory],
    {
      timeout: CLONE_TIMEOUT_MS,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  try {
    const { stdout } = await execFileAsync("git", ["-C", directory, "rev-parse", "HEAD"], {
      timeout: 15_000,
    });
    return stdout.trim();
  } catch {
    throw new Error("Repository has no commits on the default branch");
  }
}

export interface CodegraphGenerationResult {
  fileCount: number;
  connectionCount: number;
  symbolCount: number;
  symbolEdgeCount: number;
  reparsed: number;
  reused: number;
  commitSha: string;
  truncated: boolean;
  empty: boolean;
}

const KNOWLEDGE_NAMES = new Set([
  "agents.md",
  "claude.md",
  "gemini.md",
  ".cursorrules",
  ".windsurfrules",
  "copilot-instructions.md",
  "contributing.md",
  "architecture.md",
  "readme.md",
  "replit.md",
]);
const MAX_KNOWLEDGE_CHARS = 8000;
const MAX_KNOWLEDGE_TOTAL = 40_000;

/** Docs the reviewer should always read (conventions, architecture, rules). */
function collectKnowledge(files: SourceFile[]): Array<{ path: string; content: string }> {
  const knowledge: Array<{ path: string; content: string }> = [];
  let total = 0;
  for (const file of files) {
    const base = path.posix.basename(file.path).toLowerCase();
    if (!KNOWLEDGE_NAMES.has(base)) continue;
    const content =
      file.content.length > MAX_KNOWLEDGE_CHARS
        ? `${file.content.slice(0, MAX_KNOWLEDGE_CHARS)}\n… (truncated)`
        : file.content;
    if (total + content.length > MAX_KNOWLEDGE_TOTAL) break;
    knowledge.push({ path: file.path, content });
    total += content.length;
  }
  return knowledge;
}

export async function generateRepositoryCodegraph(repository: Repository): Promise<CodegraphGenerationResult> {
  await ensureCodegraphSchema();
  await storage.upsertRepositoryCodegraph(repository.id, {
    status: "indexing",
    error: null,
  });

  const directory = await mkdtemp(path.join(tmpdir(), "cortardo-codegraph-"));
  try {
    let commitSha: string;
    try {
      commitSha = await cloneRepository(repository, directory);
    } catch (error: any) {
      if (String(error?.message || "").includes("no commits")) {
        await storage.upsertRepositoryCodegraph(repository.id, {
          status: "empty",
          error: null,
          commitSha: null,
          files: [],
          connections: [],
          symbols: [],
          symbolEdges: [],
          knowledge: [],
          fileCount: 0,
          generatedAt: new Date(),
        });
        return {
          fileCount: 0,
          connectionCount: 0,
          symbolCount: 0,
          symbolEdgeCount: 0,
          reparsed: 0,
          reused: 0,
          commitSha: "",
          truncated: false,
          empty: true,
        };
      }
      throw error;
    }
    const { files, truncated } = await collectFiles(directory);
    if (files.length === 0) {
      throw new Error("No analyzable files found in repository");
    }

    // Incremental parse: reuse stored per-file analysis when the content hash
    // matches, so only changed files are re-parsed with tree-sitter.
    const existing = await storage.listRepositoryCodeFiles(repository.id);
    const existingByPath = new Map(existing.map((row) => [row.path, row]));
    const analyses: FileAnalysis[] = [];
    const changedRows: NewRepositoryCodeFile[] = [];
    let reused = 0;

    for (const file of files) {
      const contentHash = createHash("sha1").update(file.content).digest("hex");
      const prior = existingByPath.get(file.path);
      if (
        prior &&
        prior.contentHash === contentHash &&
        prior.parsed &&
        (prior.parsed as { analyzeVersion?: number }).analyzeVersion === ANALYZE_VERSION &&
        Array.isArray((prior.parsed as { symbols?: unknown }).symbols)
      ) {
        analyses.push(prior.parsed as unknown as FileAnalysis);
        reused += 1;
        continue;
      }
      const analysis = await parseSourceFile(file);
      analyses.push(analysis);
      changedRows.push({
        repositoryId: repository.id,
        path: file.path,
        contentHash,
        language: analysis.language,
        kind: analysis.kind,
        loc: analysis.loc,
        parsed: analysis as unknown as Record<string, unknown>,
      });
    }

    const currentPaths = new Set(files.map((file) => file.path));
    const removedPaths = existing
      .filter((row) => !currentPaths.has(row.path))
      .map((row) => row.path);

    await storage.upsertRepositoryCodeFiles(changedRows);
    if (removedPaths.length > 0) {
      await storage.deleteRepositoryCodeFiles(repository.id, removedPaths);
    }

    const { files: graphFiles, connections, symbols, symbolEdges } = buildAnalyzeResult(analyses);
    const knowledge = collectKnowledge(files);

    await storage.upsertRepositoryCodegraph(repository.id, {
      status: "ready",
      error: null,
      commitSha,
      files: graphFiles,
      connections,
      symbols,
      symbolEdges,
      knowledge,
      fileCount: graphFiles.length,
      generatedAt: new Date(),
    });
    await storage.updateRepository(repository.id, { indexedAt: new Date() });

    return {
      fileCount: graphFiles.length,
      connectionCount: connections.length,
      symbolCount: symbols.length,
      symbolEdgeCount: symbolEdges.length,
      reparsed: changedRows.length,
      reused,
      commitSha,
      truncated,
      empty: false,
    };
  } catch (error: any) {
    await storage
      .upsertRepositoryCodegraph(repository.id, {
        status: "error",
        error: String(error?.message || error).slice(0, 2000),
      })
      .catch(() => {});
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

const limit = pLimit(CONCURRENCY);
const inFlight = new Map<string, Promise<CodegraphGenerationResult>>();

/** Queue (or join) a codegraph build for a repository. Resolves when done. */
export function queueCodegraphIndex(repository: Repository): Promise<CodegraphGenerationResult> {
  const existing = inFlight.get(repository.id);
  if (existing) return existing;

  const task = limit(async () => {
    try {
      const result = await generateRepositoryCodegraph(repository);
      console.log(
        `[codegraph] indexed ${repository.fullName}: ${result.fileCount} files, ${result.connectionCount} edges, ` +
          `${result.symbolCount} symbols, ${result.symbolEdgeCount} symbol edges ` +
          `(${result.reparsed} reparsed, ${result.reused} reused)`,
      );
      return result;
    } catch (error: any) {
      console.error(`[codegraph] failed ${repository.fullName}:`, error?.message || error);
      throw error;
    } finally {
      inFlight.delete(repository.id);
    }
  });

  inFlight.set(repository.id, task);
  return task;
}

export function isCodegraphIndexing(repositoryId: string): boolean {
  return inFlight.has(repositoryId);
}

export async function markInterruptedCodegraphsAsError(): Promise<number> {
  try {
    await ensureCodegraphSchema();
    return await storage.markInterruptedCodegraphsAsError();
  } catch (error: any) {
    console.error("[codegraph] failed to reconcile interrupted builds:", error?.message || error);
    return 0;
  }
}
