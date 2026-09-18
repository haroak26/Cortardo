import type { Repository } from "@shared/schema";
import { storage } from "../../server/storage.ts";
import * as githubApi from "../../server/lib/github/api.ts";
import { getInstallationOctokit } from "../../server/lib/github/app.ts";
import { isSupportedCodegraphFile, parseSourceFile, type FileAnalysis } from "../../server/lib/codegraph/analyze.ts";
import type { CodegraphChangedFile, RepoGraphIndex } from "./types.ts";

const MAX_FILE_BYTES = 400_000;

/** Structural subset of the stored repository codegraph the stages consume. */
export async function loadRepoGraphIndex(repositoryId: string): Promise<RepoGraphIndex | null> {
  const graph = await storage.getRepositoryCodegraph(repositoryId);
  if (!graph || graph.status !== "ready") return null;
  return {
    commitSha: graph.commitSha ?? null,
    files: (graph.files ?? []).map((file) => ({
      id: file.id,
      path: file.path,
      language: file.language,
      kind: file.kind,
      loc: file.loc,
    })),
    connections: graph.connections ?? [],
    symbols: graph.symbols ?? [],
    symbolEdges: graph.symbolEdges ?? [],
  };
}

export interface PullRequestContext {
  installationId: string | number;
  fullName: string;
  headSha: string;
  title: string;
  body?: string;
}

export async function loadPullRequestContext(
  repository: Repository,
  pullRequestNumber: number,
): Promise<PullRequestContext> {
  if (!repository.installationId) {
    throw new Error(`repository ${repository.fullName} is not linked to a GitHub installation`);
  }
  const pullRequest = await githubApi.getPullRequest(
    repository.installationId,
    repository.fullName,
    pullRequestNumber,
  );
  if (!pullRequest.headSha) {
    throw new Error(`pull request #${pullRequestNumber} has no head SHA`);
  }
  return {
    installationId: repository.installationId,
    fullName: repository.fullName,
    headSha: pullRequest.headSha,
    title: pullRequest.title ?? "",
    body: pullRequest.body ?? undefined,
  };
}

export async function loadChangedFiles(input: {
  installationId: string | number;
  fullName: string;
  pullRequestNumber: number;
  maxFiles?: number;
}): Promise<CodegraphChangedFile[]> {
  const changed = await githubApi.listPullRequestFiles(
    input.installationId,
    input.fullName,
    input.pullRequestNumber,
    input.maxFiles,
  );
  return changed.map((file) => ({
    path: file.filename,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    patch: file.patch,
  }));
}

/**
 * Every path at the PR head. Used by stage 4 to find lockfiles, test scripts
 * and the package manifest before a sandbox is prepared.
 */
export async function listRepositoryTree(input: {
  installationId: string | number;
  fullName: string;
  headSha: string;
}): Promise<{ paths: string[]; truncated: boolean }> {
  const { owner, repo } = githubApi.splitFullName(input.fullName);
  const octokit = getInstallationOctokit(input.installationId);
  const { data } = await octokit.rest.git.getTree({
    owner,
    repo,
    tree_sha: input.headSha,
    recursive: "true",
  });
  return {
    paths: (data.tree ?? [])
      .map((entry) => entry.path)
      .filter((path): path is string => typeof path === "string" && path.length > 0),
    truncated: data.truncated === true,
  };
}

export async function analyseChangedFiles(input: {
  installationId: string | number;
  fullName: string;
  headSha: string;
  files: CodegraphChangedFile[];
}): Promise<Map<string, FileAnalysis>> {
  const analyses = new Map<string, FileAnalysis>();
  for (const file of input.files) {
    if (file.status === "removed") continue;
    if (!isSupportedCodegraphFile(file.path)) continue;
    const content = await githubApi
      .getFileContent(input.installationId, input.fullName, file.path, input.headSha)
      .catch(() => null);
    if (!content) continue;
    const analysis = await parseSourceFile({
      path: file.path,
      content: content.length > MAX_FILE_BYTES ? content.slice(0, MAX_FILE_BYTES) : content,
    });
    analyses.set(file.path, analysis);
  }
  return analyses;
}
