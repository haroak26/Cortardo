import type { PRContext } from "../context/pack";
import { deriveContext } from "../context/pack";
import { GraphIndex } from "../context/graph";
import type { RepoProfile, ReviewRequest } from "../types";

export interface PlanResult {
  graph: GraphIndex;
  context: PRContext;
}

/**
 * Plan stage: build the context index and the PR impact slice. No model calls,
 * no sandbox — a clean PR can finish without ever provisioning E2B.
 */
export function planStage(request: ReviewRequest): PlanResult {
  const graph = new GraphIndex(request.graph);
  const placeholderProfile: RepoProfile = {
    packageManager: "unknown",
    hasNodeModules: false,
    testFiles: graph.files.filter((file) => file.kind === "test").map((file) => file.path),
    scripts: {},
  };
  return { graph, context: deriveContext(request, graph, placeholderProfile) };
}
