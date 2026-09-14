/** File-level dependency graph for a repository. */

export type CodeFileKind = "source" | "test" | "config" | "docs";
export type ConnectionKind = "imports" | "calls" | "types";
export type CodegraphStatus = "pending" | "indexing" | "ready" | "error" | "empty";

export interface CodeGraphFile {
  /** Stable id — the repo-relative path. */
  id: string;
  path: string;
  name: string;
  dir: string;
  language: string;
  kind: CodeFileKind;
  loc: number;
  entry?: boolean;
  hub?: boolean;
}

export interface CodeGraphConnection {
  source: string;
  target: string;
  kind: ConnectionKind;
}

export type CodeSymbolKind = "function" | "method" | "class" | "type" | "var";

export interface CodeGraphSymbol {
  /** Stable id: `${filePath}#${qualifiedName}`. */
  id: string;
  fileId: string;
  name: string;
  qualifiedName: string;
  kind: CodeSymbolKind;
  line: number;
  endLine: number;
  signature: string;
  exported: boolean;
  /** Enclosing symbol id for methods. */
  parent: string | null;
}

export interface CodeGraphSymbolEdge {
  source: string;
  target: string;
  kind: "calls" | "references";
}

export interface CodeGraphData {
  repository: string;
  commitSha?: string | null;
  files: CodeGraphFile[];
  connections: CodeGraphConnection[];
}
