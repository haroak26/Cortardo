import type { CodeGraphSymbol, CodeGraphSymbolEdge } from "@shared/codegraph";

export interface ImpactSymbol {
  symbol: CodeGraphSymbol;
  depth: number;
}

export interface ImpactInput {
  files: Array<{ id: string; path: string; kind: string }>;
  connections: Array<{ source: string; target: string }>;
  symbols: CodeGraphSymbol[];
  symbolEdges: CodeGraphSymbolEdge[];
}

export interface ImpactResult {
  changedSymbols: CodeGraphSymbol[];
  /** Symbols outside the diff that call into the changed code. */
  callers: ImpactSymbol[];
  /** Symbols the changed code calls (nearby context). */
  callees: ImpactSymbol[];
  /** Test files that likely cover the changed files. */
  tests: string[];
}

const MAX_CALLERS = 30;
const MAX_CALLEES = 20;
const MAX_TESTS = 10;

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const bucket = map.get(key);
  if (bucket) bucket.push(value);
  else map.set(key, [value]);
}

function collect(
  adjacency: Map<string, string[]>,
  starts: Set<string>,
  symbolById: Map<string, CodeGraphSymbol>,
  maxDepth: number,
  excludeFiles: Set<string> | null,
  limit: number,
): ImpactSymbol[] {
  const seen = new Set(starts);
  const queue = [...starts].map((id) => ({ id, depth: 0 }));
  const out: ImpactSymbol[] = [];

  while (queue.length > 0 && out.length < limit) {
    const current = queue.shift()!;
    if (current.depth >= maxDepth) continue;
    for (const next of adjacency.get(current.id) ?? []) {
      if (seen.has(next)) continue;
      seen.add(next);
      const symbol = symbolById.get(next);
      if (!symbol) continue;
      const depth = current.depth + 1;
      if (!excludeFiles || !excludeFiles.has(symbol.fileId)) {
        out.push({ symbol, depth });
      }
      queue.push({ id: next, depth });
    }
  }
  return out.slice(0, limit);
}

export function testCandidates(filePath: string): string[] {
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
  if (ext === ".py") {
    candidates.push(`${dir}test_${name}.py`, `${dir}${name}_test.py`, `${dir}tests/test_${name}.py`);
  }
  return candidates;
}

export function analyseImpact(input: ImpactInput, changedFiles: string[]): ImpactResult {
  const changedSet = new Set(changedFiles);
  const symbolById = new Map(input.symbols.map((symbol) => [symbol.id, symbol]));

  const callersOf = new Map<string, string[]>();
  const calleesOf = new Map<string, string[]>();
  for (const edge of input.symbolEdges) {
    push(callersOf, edge.target, edge.source);
    push(calleesOf, edge.source, edge.target);
  }

  const changedSymbols = input.symbols.filter((symbol) => changedSet.has(symbol.fileId));
  const changedIds = new Set(changedSymbols.map((symbol) => symbol.id));

  const callers = collect(callersOf, changedIds, symbolById, 2, changedSet, MAX_CALLERS);
  const callees = collect(calleesOf, changedIds, symbolById, 1, null, MAX_CALLEES);

  const fileIds = new Set(input.files.map((file) => file.id));
  const tests = new Set<string>();
  const testFilesByName = new Map(
    input.files
      .filter((file) => file.kind === "test")
      .map((file) => [file.id, file]),
  );
  for (const path of changedFiles) {
    for (const candidate of testCandidates(path)) {
      if (testFilesByName.has(candidate)) tests.add(candidate);
    }
  }
  for (const connection of input.connections) {
    if (!changedSet.has(connection.target)) continue;
    if (testFilesByName.has(connection.source)) tests.add(connection.source);
  }

  return {
    changedSymbols,
    callers,
    callees,
    tests: [...tests].filter((path) => fileIds.has(path)).slice(0, MAX_TESTS),
  };
}
