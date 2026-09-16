/**
 * Repository context index (3.5).
 *
 * L0 is the stored code graph supplied by the server (tree-sitter symbols,
 * call/reference edges, string refs, docs). L1 is a lightweight overlay of the
 * changed files at the PR head so new keys, routes and imports are visible even
 * when the stored graph is one commit behind.
 */
import type { GraphConnection, GraphFile, GraphStringRef, GraphSymbol, GraphSymbolEdge, RepoGraphInput } from "../types";
import { hashContent } from "../util";

const MAX_OVERLAY_STRINGS = 240;
const MIN_STRING_LENGTH = 4;

export interface ImpactSymbolRef {
  symbol: GraphSymbol;
  depth: number;
}

export interface StringConsumer {
  value: string;
  path: string;
  line: number;
  changed: boolean;
}

export interface ImpactSlice {
  changedSymbols: GraphSymbol[];
  callers: ImpactSymbolRef[];
  callees: ImpactSymbolRef[];
  tests: string[];
  importers: string[];
  stringConsumers: StringConsumer[];
}

function isKeyLike(value: string): boolean {
  if (value.length < MIN_STRING_LENGTH || value.length > 80) return false;
  if (!/[A-Za-z]/.test(value)) return false;
  if (/[\s\\]/.test(value)) return false;
  if (/^https?:/.test(value)) return false;
  return true;
}

/** Lightweight string extraction from changed files (mirrors the graph parser). */
export function extractStrings(content: string): Array<{ value: string; line: number }> {
  const out: Array<{ value: string; line: number }> = [];
  const seen = new Set<string>();
  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    for (const match of lines[index].matchAll(/["'`]([^"'`\n]{2,80})["'`]/g)) {
      const value = match[1].trim();
      if (!isKeyLike(value) || value.includes("/") || value.includes("\\")) continue;
      if (seen.has(value)) continue;
      seen.add(value);
      out.push({ value, line: index + 1 });
      if (out.length >= MAX_OVERLAY_STRINGS) return out;
    }
  }
  return out;
}

function testCandidates(filePath: string): string[] {
  const ext = filePath.match(/\.[^./]+$/)?.[0] ?? "";
  const base = ext ? filePath.slice(0, -ext.length) : filePath;
  const name = base.split("/").pop() ?? base;
  const dir = base.slice(0, base.length - name.length);
  const candidates = [
    `${base}.test${ext}`,
    `${base}.spec${ext}`,
    `${dir}__tests__/${name}${ext}`,
    `${dir}${name}.test${ext}`,
    `${dir}${name}.spec${ext}`,
  ];
  if (ext === ".py") candidates.push(`${dir}test_${name}.py`, `${dir}${name}_test.py`, `${dir}tests/test_${name}.py`);
  return candidates;
}

export class GraphIndex {
  readonly files: GraphFile[];
  readonly symbols: GraphSymbol[];
  readonly connections: GraphConnection[];
  readonly symbolEdges: GraphSymbolEdge[];
  readonly strings: GraphStringRef[];
  readonly knowledge: Array<{ path: string; content: string }>;
  private readonly fileSet: Set<string>;
  private readonly symbolById: Map<string, GraphSymbol>;
  private readonly symbolsByName: Map<string, GraphSymbol[]>;
  private readonly callerMap: Map<string, string[]>;
  private readonly calleeMap: Map<string, string[]>;
  private readonly overlayStrings = new Map<string, Array<{ value: string; line: number }>>();
  private readonly overlayImports = new Map<string, string[]>();
  private readonly stringIndex = new Map<string, GraphStringRef[]>();
  readonly hash: string;

  constructor(input: RepoGraphInput = {}) {
    this.files = input.files ?? [];
    this.symbols = input.symbols ?? [];
    this.connections = input.connections ?? [];
    this.symbolEdges = input.symbolEdges ?? [];
    this.strings = input.strings ?? [];
    this.knowledge = input.knowledge ?? [];
    this.fileSet = new Set(this.files.map((file) => file.path));
    this.symbolById = new Map(this.symbols.map((symbol) => [symbol.id, symbol]));
    this.symbolsByName = new Map();
    for (const symbol of this.symbols) {
      const bucket = this.symbolsByName.get(symbol.name);
      if (bucket) bucket.push(symbol);
      else this.symbolsByName.set(symbol.name, [symbol]);
    }
    this.callerMap = new Map();
    this.calleeMap = new Map();
    for (const edge of this.symbolEdges) {
      const callers = this.callerMap.get(edge.target) ?? [];
      callers.push(edge.source);
      this.callerMap.set(edge.target, callers);
      const callees = this.calleeMap.get(edge.source) ?? [];
      callees.push(edge.target);
      this.calleeMap.set(edge.source, callees);
    }
    for (const ref of this.strings) {
      const bucket = this.stringIndex.get(ref.value);
      if (bucket) bucket.push(ref);
      else this.stringIndex.set(ref.value, [ref]);
    }
    this.hash = hashContent(
      JSON.stringify([
        this.files.length,
        this.symbols.length,
        this.symbolEdges.length,
        this.strings.length,
        this.symbols.slice(0, 200).map((symbol) => symbol.id),
      ]),
    );
  }

  hasFile(path: string): boolean {
    return this.fileSet.has(path);
  }

  /** Record changed-file strings and imports at the PR head. */
  overlay(path: string, content: string): void {
    this.overlayStrings.set(path, extractStrings(content));
    const imports: string[] = [];
    for (const match of content.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)) {
      if (match[1].startsWith(".") || match[1].startsWith("@/")) imports.push(match[1]);
    }
    this.overlayImports.set(path, imports);
  }

  changedStrings(paths: string[]): Array<{ value: string; path: string; line: number }> {
    const out: Array<{ value: string; path: string; line: number }> = [];
    for (const path of paths) {
      for (const entry of this.overlayStrings.get(path) ?? []) out.push({ ...entry, path });
    }
    return out;
  }

  symbolByIdOrName(idOrName: string): GraphSymbol | undefined {
    return this.symbolById.get(idOrName) ?? this.symbolsByName.get(idOrName)?.[0];
  }

  symbolsInFile(path: string): GraphSymbol[] {
    return this.symbols.filter((symbol) => symbol.fileId === path);
  }

  searchSymbols(query: string, limit = 20): GraphSymbol[] {
    const needle = query.toLowerCase();
    const exact = this.symbolsByName.get(query) ?? [];
    const partial = this.symbols.filter((symbol) => symbol.name.toLowerCase().includes(needle));
    const merged = [...exact, ...partial.filter((symbol) => !exact.includes(symbol))];
    return merged.slice(0, limit);
  }

  callersOf(symbolId: string, depth = 2, limit = 30): ImpactSymbolRef[] {
    return this.collect(this.callerMap, symbolId, depth, limit);
  }

  calleesOf(symbolId: string, depth = 1, limit = 20): ImpactSymbolRef[] {
    return this.collect(this.calleeMap, symbolId, depth, limit);
  }

  private collect(adjacency: Map<string, string[]>, start: string, depth: number, limit: number): ImpactSymbolRef[] {
    const seen = new Set([start]);
    const queue: Array<{ id: string; depth: number }> = [{ id: start, depth: 0 }];
    const out: ImpactSymbolRef[] = [];
    while (queue.length > 0 && out.length < limit) {
      const current = queue.shift()!;
      if (current.depth >= depth) continue;
      for (const next of adjacency.get(current.id) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        const symbol = this.symbolById.get(next);
        const nextDepth = current.depth + 1;
        if (symbol) out.push({ symbol, depth: nextDepth });
        queue.push({ id: next, depth: nextDepth });
      }
    }
    return out;
  }

  searchStrings(query: string, limit = 20): StringConsumer[] {
    const needle = query.toLowerCase();
    const out: StringConsumer[] = [];
    for (const [value, refs] of this.stringIndex) {
      if (!value.toLowerCase().includes(needle)) continue;
      for (const ref of refs) out.push({ value, path: ref.path, line: ref.line, changed: false });
      if (out.length >= limit) break;
    }
    for (const [path, entries] of this.overlayStrings) {
      for (const entry of entries) {
        if (!entry.value.toLowerCase().includes(needle)) continue;
        out.push({ value: entry.value, path, line: entry.line, changed: true });
        if (out.length >= limit) return out;
      }
    }
    return out.slice(0, limit);
  }

  /** Impact slice for the changed files: callers, callees, tests, string consumers. */
  impact(changedFiles: string[], testFiles: string[] = []): ImpactSlice {
    const changedSet = new Set(changedFiles);
    const changedSymbols = this.symbols.filter((symbol) => changedSet.has(symbol.fileId));
    const callers: ImpactSymbolRef[] = [];
    const callees: ImpactSymbolRef[] = [];
    const seenCallers = new Set<string>();
    const seenCallees = new Set<string>();
    for (const symbol of changedSymbols) {
      for (const ref of this.callersOf(symbol.id, 2, 30)) {
        if (changedSet.has(ref.symbol.fileId) || seenCallers.has(ref.symbol.id)) continue;
        seenCallers.add(ref.symbol.id);
        callers.push(ref);
      }
      for (const ref of this.calleesOf(symbol.id, 1, 12)) {
        if (seenCallees.has(ref.symbol.id)) continue;
        seenCallees.add(ref.symbol.id);
        callees.push(ref);
      }
    }

    const tests = new Set<string>();
    const knownTest = new Set([...testFiles, ...this.files.filter((file) => file.kind === "test").map((file) => file.path)]);
    for (const path of changedFiles) {
      for (const candidate of testCandidates(path)) {
        if (knownTest.has(candidate)) tests.add(candidate);
      }
    }
    for (const connection of this.connections) {
      if (changedSet.has(connection.target) && knownTest.has(connection.source)) tests.add(connection.source);
    }

    const importers = new Set<string>();
    for (const connection of this.connections) {
      if (changedSet.has(connection.target) && !changedSet.has(connection.source)) importers.add(connection.source);
    }

    const stringConsumers: StringConsumer[] = [];
    const seenValues = new Set<string>();
    for (const changed of this.changedStrings(changedFiles)) {
      if (seenValues.has(changed.value)) continue;
      seenValues.add(changed.value);
      for (const consumer of this.searchStrings(changed.value, 6)) {
        stringConsumers.push(consumer);
        if (stringConsumers.length >= 40) break;
      }
      if (stringConsumers.length >= 40) break;
    }

    return {
      changedSymbols,
      callers: callers.slice(0, 30),
      callees: callees.slice(0, 20),
      tests: [...tests].slice(0, 10),
      importers: [...importers].slice(0, 20),
      stringConsumers,
    };
  }

}
