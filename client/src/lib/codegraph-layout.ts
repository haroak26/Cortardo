/* Ordering + adjacency for the mock codegraph.
   The Codebase map renders files as dots in a concentric grid and links every
   dot into one chain. Files are ordered so most chain links are real imports:
   a greedy Warnsdorff walk over the undirected graph, falling back to the next
   file in folder order when the walk dead-ends. */

import type { CodeGraphConnection, CodeGraphFile } from './mock-codegraph-data';

export const BLOCK_SIZE = 12;
export const BLOCK_GAP = 4;

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphLayout {
  /** Files in chain/display order. */
  nodes: CodeGraphFile[];
  byId: Map<string, CodeGraphFile>;
  /** Undirected adjacency. */
  neighbours: Map<string, Set<string>>;
  /** Deduped directional import edges (source → target). */
  edges: GraphEdge[];
}

function dirOrder(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '.') return -1;
  if (b === '.') return 1;
  const aTest = a.startsWith('test');
  const bTest = b.startsWith('test');
  if (aTest !== bTest) return aTest ? 1 : -1;
  return a < b ? -1 : 1;
}

function fileOrder(a: CodeGraphFile, b: CodeGraphFile): number {
  const dir = dirOrder(a.dir, b.dir);
  if (dir !== 0) return dir;
  if (a.entry !== b.entry) return a.entry ? -1 : 1;
  if (a.hub !== b.hub) return a.hub ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

export function buildGraphLayout(files: CodeGraphFile[], connections: CodeGraphConnection[]): GraphLayout {
  const sorted = files.slice().sort(fileOrder);
  const byId = new Map(sorted.map((file) => [file.id, file]));

  const neighbours = new Map<string, Set<string>>();
  const edges: GraphEdge[] = [];
  const seenEdges = new Set<string>();
  for (const connection of connections) {
    if (
      connection.source === connection.target ||
      !byId.has(connection.source) ||
      !byId.has(connection.target)
    ) {
      continue;
    }
    const edgeKey = `${connection.source}|${connection.target}`;
    if (!seenEdges.has(edgeKey)) {
      seenEdges.add(edgeKey);
      edges.push({ source: connection.source, target: connection.target });
    }
    if (!neighbours.has(connection.source)) neighbours.set(connection.source, new Set());
    if (!neighbours.has(connection.target)) neighbours.set(connection.target, new Set());
    neighbours.get(connection.source)!.add(connection.target);
    neighbours.get(connection.target)!.add(connection.source);
  }

  const folderIndex = new Map(sorted.map((file, index) => [file.id, index]));
  const visited = new Set<string>();
  const remaining = (id: string): number =>
    [...(neighbours.get(id) ?? [])].filter((neighbour) => !visited.has(neighbour)).length;

  const nodes: CodeGraphFile[] = [];
  let current: CodeGraphFile | undefined = sorted[0];
  while (current) {
    visited.add(current.id);
    nodes.push(current);
    const candidates: string[] = [...(neighbours.get(current.id) ?? [])].filter(
      (neighbour) => !visited.has(neighbour),
    );
    if (candidates.length > 0) {
      candidates.sort((a, b) => {
        const left = remaining(a);
        const right = remaining(b);
        if (left !== right) return left - right;
        return folderIndex.get(a)! - folderIndex.get(b)!;
      });
      current = byId.get(candidates[0])!;
    } else {
      current = sorted.find((file) => !visited.has(file.id));
    }
  }

  return { nodes, byId, neighbours, edges };
}
