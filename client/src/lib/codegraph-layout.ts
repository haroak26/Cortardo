/* Volumetric spherical layout for the codegraph.
   Files are grouped into balanced folder clusters. Cluster centres are spread
   through the volume of a sphere (some near the core, some near the shell) and
   files form compact 3D knots around their centre. A light anchored relaxation
   tightens real intra-cluster edges and pushes overlapping knots apart, so the
   globe is made of dots and connections rather than a shell. */

import type { CodeGraphConnection, CodeGraphFile, ConnectionKind } from './mock-codegraph-data';

export const BLOCK_SIZE = 12;
export const BLOCK_GAP = 4;

export interface GraphEdge {
  source: string;
  target: string;
  kind: ConnectionKind;
  /** Membership links added for files with no code connections of their own. */
  synthetic?: boolean;
}

export interface GraphPosition {
  x: number;
  y: number;
  z: number;
}

export interface GraphLayout {
  /** Files in display order. */
  nodes: CodeGraphFile[];
  byId: Map<string, CodeGraphFile>;
  /** Undirected adjacency (includes synthetic membership links). */
  neighbours: Map<string, Set<string>>;
  /** Deduped directional edges (source → target). */
  edges: GraphEdge[];
  /** 3D coordinates inside a unit sphere. */
  positions: Map<string, GraphPosition>;
  /** Cluster index per file. */
  clusterOf: Map<string, number>;
  /** Number of clusters. */
  clusterCount: number;
}

const RADIUS = 1;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_CLUSTER = 16;

interface ClusterNode {
  files: CodeGraphFile[];
  children: ClusterNode[];
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

function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fibonacciSphereDirection(count: number, index: number): [number, number, number] {
  if (count === 1) return [0, 0, 1];
  const y = 1 - (2 * (index + 0.5)) / count;
  const radius = Math.sqrt(Math.max(0, 1 - y * y));
  const theta = index * GOLDEN_ANGLE;
  return [Math.cos(theta) * radius, y, Math.sin(theta) * radius];
}

function segmentFor(file: CodeGraphFile, depth: number): string | null {
  if (file.dir === '.') return null;
  const parts = file.dir.split('/');
  return parts[depth] ?? null;
}

/** Recursively split by folder until each cluster is small enough to read. */
function buildCluster(files: CodeGraphFile[], depth: number): ClusterNode {
  const node: ClusterNode = { files, children: [] };
  if (files.length <= MAX_CLUSTER) return node;

  const groups = new Map<string, CodeGraphFile[]>();
  for (const file of files) {
    const segment = segmentFor(file, depth) ?? `·${file.kind}`;
    const group = groups.get(segment);
    if (group) group.push(file);
    else groups.set(segment, [file]);
  }

  if (groups.size <= 1) return node;

  for (const group of groups.values()) {
    group.sort(fileOrder);
    node.children.push(buildCluster(group, depth + 1));
  }
  return node;
}

function collectLeaves(node: ClusterNode, leaves: ClusterNode[]): void {
  if (node.children.length === 0) {
    leaves.push(node);
    return;
  }
  for (const child of node.children) collectLeaves(child, leaves);
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
      edges.push({ source: connection.source, target: connection.target, kind: connection.kind });
    }
    if (!neighbours.has(connection.source)) neighbours.set(connection.source, new Set());
    if (!neighbours.has(connection.target)) neighbours.set(connection.target, new Set());
    neighbours.get(connection.source)!.add(connection.target);
    neighbours.get(connection.target)!.add(connection.source);
  }

  const n = sorted.length;
  const positions = new Map<string, GraphPosition>();
  const clusterOf = new Map<string, number>();
  if (n === 0) {
    return { nodes: sorted, byId, neighbours, edges, positions, clusterOf, clusterCount: 0 };
  }
  if (n === 1) {
    positions.set(sorted[0].id, { x: 0, y: 0, z: RADIUS });
    clusterOf.set(sorted[0].id, 0);
    return { nodes: sorted, byId, neighbours, edges, positions, clusterOf, clusterCount: 1 };
  }

  const root = buildCluster(sorted, 0);
  const leaves: ClusterNode[] = [];
  collectLeaves(root, leaves);
  leaves.forEach((leaf, index) => {
    for (const file of leaf.files) clusterOf.set(file.id, index);
  });

  const indexOf = new Map(sorted.map((file, index) => [file.id, index]));
  const xs = new Array<number>(n);
  const ys = new Array<number>(n);
  const zs = new Array<number>(n);
  const anchorX = new Array<number>(n);
  const anchorY = new Array<number>(n);
  const anchorZ = new Array<number>(n);
  const fx = new Array<number>(n);
  const fy = new Array<number>(n);
  const fz = new Array<number>(n);

  // Cluster centres fill the sphere volume: early clusters sit near the core,
  // later clusters spread toward the shell.
  const clusterCenters: Array<[number, number, number]> = leaves.map((leaf, index) => {
    const [dx, dy, dz] = fibonacciSphereDirection(leaves.length, index);
    // Bias clusters toward the shell so the map reads as a sphere, with a
    // thinner spread of clusters filling inward toward the core.
    const fraction = Math.pow((index + 0.5) / leaves.length, 0.5);
    const radius = 0.3 + 0.68 * fraction;
    const jitter = mulberry32(hashString(`cluster:${index}`));
    return [
      dx * radius + (jitter() - 0.5) * 0.05,
      dy * radius + (jitter() - 0.5) * 0.05,
      dz * radius + (jitter() - 0.5) * 0.05,
    ];
  });

  leaves.forEach((leaf, clusterIndex) => {
    const [cx, cy, cz] = clusterCenters[clusterIndex];
    const members = leaf.files.slice().sort(fileOrder);
    const blob = 0.05 + 0.045 * Math.sqrt(members.length);
    members.forEach((file, slot) => {
      const random = mulberry32(hashString(file.id));
      const [dx, dy, dz] = fibonacciSphereDirection(members.length, slot);
      const fraction = Math.sqrt((slot + 0.5) / members.length);
      const radius = blob * fraction;
      const index = indexOf.get(file.id)!;
      const x = cx + dx * radius + (random() - 0.5) * 0.015;
      const y = cy + dy * radius + (random() - 0.5) * 0.015;
      const z = cz + dz * radius + (random() - 0.5) * 0.015;
      xs[index] = x;
      ys[index] = y;
      zs[index] = z;
      anchorX[index] = x;
      anchorY[index] = y;
      anchorZ[index] = z;
    });
  });

  const edgeU = new Array<number>(edges.length);
  const edgeV = new Array<number>(edges.length);
  edges.forEach((edge, index) => {
    edgeU[index] = indexOf.get(edge.source)!;
    edgeV[index] = indexOf.get(edge.target)!;
  });

  const degree = sorted.map((file) => neighbours.get(file.id)?.size ?? 0);
  const clusterId = sorted.map((file) => clusterOf.get(file.id) ?? 0);

  const iterations = n <= 200 ? 70 : n <= 600 ? 55 : 40;
  const ideal = 1.7 / Math.sqrt(n);
  const cutoff = Math.max(ideal * 2.4, 0.09);
  const cellSize = Math.max(cutoff, 1e-4);
  const cellCount = Math.max(2, Math.ceil((2 * (RADIUS + 0.4)) / cellSize) + 1);

  const cellCoord = (value: number) =>
    Math.min(cellCount - 1, Math.max(0, Math.floor(((value + RADIUS + 0.4) / (2 * (RADIUS + 0.4))) * cellCount)));

  for (let step = 0; step < iterations; step += 1) {
    const progress = step / iterations;
    const temperature = 0.03 * (1 - progress) * (1 - progress) + 0.0009;
    const repulsion = ideal * ideal;

    for (let i = 0; i < n; i += 1) {
      fx[i] = 0;
      fy[i] = 0;
      fz[i] = 0;
    }

    const grid = new Map<number, number[]>();
    for (let i = 0; i < n; i += 1) {
      const key = (cellCoord(xs[i]) * cellCount + cellCoord(ys[i])) * cellCount + cellCoord(zs[i]);
      const bucket = grid.get(key);
      if (bucket) bucket.push(i);
      else grid.set(key, [i]);
    }

    for (let i = 0; i < n; i += 1) {
      const ix = cellCoord(xs[i]);
      const iy = cellCoord(ys[i]);
      const iz = cellCoord(zs[i]);
      for (let gx = ix - 1; gx <= ix + 1; gx += 1) {
        if (gx < 0 || gx >= cellCount) continue;
        for (let gy = iy - 1; gy <= iy + 1; gy += 1) {
          if (gy < 0 || gy >= cellCount) continue;
          for (let gz = iz - 1; gz <= iz + 1; gz += 1) {
            if (gz < 0 || gz >= cellCount) continue;
            const bucket = grid.get((gx * cellCount + gy) * cellCount + gz);
            if (!bucket) continue;
            for (const j of bucket) {
              if (j === i) continue;
              const dx = xs[i] - xs[j];
              const dy = ys[i] - ys[j];
              const dz = zs[i] - zs[j];
              const distance = Math.hypot(dx, dy, dz);
              if (distance >= cutoff || distance < 1e-6) continue;
              const force = repulsion * (1 / distance - 1 / cutoff) * 0.6;
              fx[i] += (dx / distance) * force;
              fy[i] += (dy / distance) * force;
              fz[i] += (dz / distance) * force;
            }
          }
        }
      }
    }

    // Intra-cluster edges tighten each knot; cross-cluster edges only render.
    for (let e = 0; e < edgeU.length; e += 1) {
      const a = edgeU[e];
      const b = edgeV[e];
      if (clusterId[a] !== clusterId[b]) continue;
      const dx = xs[b] - xs[a];
      const dy = ys[b] - ys[a];
      const dz = zs[b] - zs[a];
      const distance = Math.hypot(dx, dy, dz) || 1e-6;
      const rest = ideal * 1.5;
      if (distance <= rest) continue;
      const force = Math.min((distance - rest) * 0.45, 0.16);
      const unitX = dx / distance;
      const unitY = dy / distance;
      const unitZ = dz / distance;
      fx[a] += unitX * force;
      fy[a] += unitY * force;
      fz[a] += unitZ * force;
      fx[b] -= unitX * force;
      fy[b] -= unitY * force;
      fz[b] -= unitZ * force;
    }

    for (let i = 0; i < n; i += 1) {
      const anchorPull = degree[i] === 0 ? 0.4 : 0.24;
      fx[i] += (anchorX[i] - xs[i]) * anchorPull;
      fy[i] += (anchorY[i] - ys[i]) * anchorPull;
      fz[i] += (anchorZ[i] - zs[i]) * anchorPull;

      const radius = Math.hypot(xs[i], ys[i], zs[i]);
      if (radius > RADIUS * 0.98) {
        const squeeze = (RADIUS * 0.98 - radius) * 0.6;
        fx[i] += (xs[i] / radius) * squeeze;
        fy[i] += (ys[i] / radius) * squeeze;
        fz[i] += (zs[i] / radius) * squeeze;
      }

      const magnitude = Math.hypot(fx[i], fy[i], fz[i]);
      if (magnitude < 1e-9) continue;
      const displacement = Math.min(magnitude, temperature);
      xs[i] += (fx[i] / magnitude) * displacement;
      ys[i] += (fy[i] / magnitude) * displacement;
      zs[i] += (fz[i] / magnitude) * displacement;
    }
  }

  // Membership links: files with no code edges still connect to the nearest
  // file of their cluster so every dot is part of the map.
  const syntheticPairs: Array<[number, number]> = [];
  for (let i = 0; i < n; i += 1) {
    if (degree[i] > 0) continue;
    let best = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      if (clusterId[j] !== clusterId[i] && best !== -1) continue;
      const distance = Math.hypot(xs[i] - xs[j], ys[i] - ys[j], zs[i] - zs[j]);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = j;
      }
    }
    if (best !== -1) syntheticPairs.push([i, best]);
  }

  const scaleRadius = Math.max(
    ...Array.from({ length: n }, (_, i) => Math.hypot(xs[i], ys[i], zs[i])),
    1e-6,
  );
  const scale = RADIUS / scaleRadius;
  sorted.forEach((file, index) => {
    positions.set(file.id, { x: xs[index] * scale, y: ys[index] * scale, z: zs[index] * scale });
  });

  const resultEdges = edges.slice();
  for (const [a, b] of syntheticPairs) {
    const source = sorted[a].id;
    const target = sorted[b].id;
    resultEdges.push({ source, target, kind: 'imports', synthetic: true });
    if (!neighbours.has(source)) neighbours.set(source, new Set());
    if (!neighbours.has(target)) neighbours.set(target, new Set());
    neighbours.get(source)!.add(target);
    neighbours.get(target)!.add(source);
  }

  return {
    nodes: sorted,
    byId,
    neighbours,
    edges: resultEdges,
    positions,
    clusterOf,
    clusterCount: leaves.length,
  };
}
