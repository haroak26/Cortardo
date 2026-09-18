import type { CodeGraphSymbol } from "@shared/codegraph";
import type { FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import { testCandidates } from "../../server/lib/codegraph/impact.ts";
import type {
  CodegraphCaller,
  CodegraphCallee,
  CodegraphChangedFile,
  CodegraphFileGraph,
  CodegraphReport,
  RepoGraphIndex,
} from "./types.ts";

export interface BuildCodegraphReportInput {
  repository: string;
  pullRequestNumber: number;
  headSha: string;
  files: CodegraphChangedFile[];
  /** Fresh analysis of each changed file at the PR head (path -> analysis). */
  analyses: Map<string, FileAnalysis>;
  index?: RepoGraphIndex | null;
  maxFiles?: number;
  maxSymbolsPerFile?: number;
  maxRelationsPerFile?: number;
}

const DEFAULT_MAX_FILES = 40;
const DEFAULT_MAX_SYMBOLS = 30;
const DEFAULT_MAX_RELATIONS = 12;

function symbolId(symbol: CodeGraphSymbol): string {
  return symbol.id || `${symbol.fileId}#${symbol.qualifiedName || symbol.name}`;
}

function label(symbol: CodeGraphSymbol): string {
  return symbol.qualifiedName || symbol.name;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function likelyTests(path: string, index: RepoGraphIndex | null): string[] {
  if (!index) return [];
  const testFiles = new Set(index.files.filter((file) => file.kind === "test").map((file) => file.id));
  const found = new Set<string>();
  for (const candidate of testCandidates(path)) {
    if (testFiles.has(candidate)) found.add(candidate);
  }
  for (const connection of index.connections) {
    if (connection.target === path && testFiles.has(connection.source)) found.add(connection.source);
  }
  return [...found].slice(0, 8);
}

export function buildCodegraphReport(input: BuildCodegraphReportInput): CodegraphReport {
  const maxFiles = input.maxFiles ?? DEFAULT_MAX_FILES;
  const maxSymbols = input.maxSymbolsPerFile ?? DEFAULT_MAX_SYMBOLS;
  const maxRelations = input.maxRelationsPerFile ?? DEFAULT_MAX_RELATIONS;
  const index = input.index ?? null;

  const changed = input.files.slice(0, maxFiles);
  const changedPaths = new Set(changed.map((file) => file.path));

  const indexFiles = new Map((index?.files ?? []).map((file) => [file.id, file]));
  const symbolById = new Map<string, CodeGraphSymbol>();
  for (const symbol of index?.symbols ?? []) symbolById.set(symbolId(symbol), symbol);

  const importsBySource = new Map<string, string[]>();
  const importedByTarget = new Map<string, string[]>();
  for (const connection of index?.connections ?? []) {
    push(importsBySource, connection.source, connection.target);
    push(importedByTarget, connection.target, connection.source);
  }

  const callersByFile = new Map<string, CodegraphCaller[]>();
  const calleesByFile = new Map<string, CodegraphCallee[]>();
  for (const edge of index?.symbolEdges ?? []) {
    const source = symbolById.get(edge.source);
    const target = symbolById.get(edge.target);
    if (!source || !target) continue;
    if (!changedPaths.has(source.fileId) && changedPaths.has(target.fileId)) {
      push(callersByFile, target.fileId, { symbol: label(source), file: source.fileId, via: label(target) });
    }
    if (changedPaths.has(source.fileId) && !changedPaths.has(target.fileId)) {
      push(calleesByFile, source.fileId, { symbol: label(target), file: target.fileId });
    }
  }

  const unsupported: string[] = [];
  const missingFromIndex: string[] = [];
  const files: CodegraphFileGraph[] = [];

  for (const file of changed) {
    const analysis = input.analyses.get(file.path);
    if (!analysis) {
      unsupported.push(file.path);
      continue;
    }
    if (index && !indexFiles.has(file.path)) missingFromIndex.push(file.path);

    const symbols = analysis.symbols.slice(0, maxSymbols).map((symbol) => ({
      id: symbolId(symbol),
      name: symbol.name,
      qualifiedName: symbol.qualifiedName || symbol.name,
      kind: symbol.kind,
      line: symbol.line,
      endLine: symbol.endLine,
      signature: symbol.signature,
      exported: symbol.exported,
      parent: symbol.parent,
    }));

    const imports: Array<{ path: string; changed: boolean }> = [];
    const seenImports = new Set<string>();
    for (const target of importsBySource.get(file.path) ?? []) {
      if (seenImports.has(target)) continue;
      seenImports.add(target);
      imports.push({ path: target, changed: changedPaths.has(target) });
    }
    if (imports.length === 0) {
      for (const entry of analysis.imports) {
        const specifier = entry[1];
        if (!specifier || seenImports.has(specifier)) continue;
        seenImports.add(specifier);
        imports.push({ path: specifier, changed: false });
      }
    }

    const importedBy = [...new Set(importedByTarget.get(file.path) ?? [])].slice(0, maxRelations);
    const callers = (callersByFile.get(file.path) ?? []).slice(0, maxRelations);
    const callees = (calleesByFile.get(file.path) ?? []).slice(0, maxRelations);
    const tests = likelyTests(file.path, index);

    files.push({
      path: file.path,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      language: analysis.language,
      kind: analysis.kind,
      loc: analysis.loc,
      indexed: indexFiles.has(file.path),
      symbols,
      imports: imports.slice(0, maxRelations),
      importedBy,
      callers,
      callees,
      tests,
    });
  }

  const warnings: string[] = [];
  if (input.files.length > changed.length) {
    warnings.push(`showing ${changed.length} of ${input.files.length} changed files`);
  }
  if (!index) {
    warnings.push("repository has no ready code index; only per-file symbols are reported");
  } else if (index.commitSha && index.commitSha !== input.headSha) {
    warnings.push(`code index is at ${index.commitSha.slice(0, 8)}, not the PR head ${input.headSha.slice(0, 8)}; cross-file edges reflect the indexed revision`);
  }
  if (missingFromIndex.length > 0) {
    warnings.push(`${missingFromIndex.length} changed file(s) are not in the index (added in this PR)`);
  }
  if (unsupported.length > 0) {
    warnings.push(`${unsupported.length} changed file(s) are not analyzable source files`);
  }

  const totals = {
    files: files.length,
    indexed: files.filter((file) => file.indexed).length,
    symbols: files.reduce((sum, file) => sum + file.symbols.length, 0),
    callers: files.reduce((sum, file) => sum + file.callers.length, 0),
    tests: files.reduce((sum, file) => sum + file.tests.length, 0),
  };

  return {
    repository: input.repository,
    pullRequestNumber: input.pullRequestNumber,
    headSha: input.headSha,
    indexCommitSha: index?.commitSha ?? null,
    indexFileCount: index?.files.length ?? 0,
    files,
    unsupported,
    missingFromIndex,
    warnings,
    totals,
  };
}
