import { getInstallationOctokit } from "../../server/lib/github/app.ts";
import { splitFullName } from "../../server/lib/github/api.ts";

export interface BetabotCommentInput {
  installationId: string | number;
  fullName: string;
  pullRequestNumber: number;
  marker: string;
  body: string;
}

export interface BetabotCommentResult {
  id: number;
  url: string | null;
  replaced: number;
}

export interface BetabotCommentSummary {
  id: number;
  body: string;
  url: string | null;
  author: string | null;
}

function hasMarker(body: string | null | undefined, marker: string): boolean {
  return Boolean(body && body.includes(marker));
}

/**
 * Comments published by the Agent always carry a stage marker. Re-runs delete
 * the previous marker comment (same stage) and post a fresh one, so the PR
 * conversation keeps exactly one live Betabot comment per stage.
 */
export async function publishBetabotComment(input: BetabotCommentInput): Promise<BetabotCommentResult> {
  const { owner, repo } = splitFullName(input.fullName);
  const octokit = getInstallationOctokit(input.installationId);

  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: input.pullRequestNumber,
    per_page: 100,
  });
  let replaced = 0;
  for (const comment of comments) {
    if (comment.user?.type !== "Bot") continue;
    if (!hasMarker(comment.body, input.marker)) continue;
    await octokit.rest.issues.deleteComment({ owner, repo, comment_id: comment.id });
    replaced += 1;
  }

  const { data } = await octokit.rest.issues.createComment({
    owner,
    repo,
    issue_number: input.pullRequestNumber,
    body: input.body,
  });
  return { id: data.id, url: data.html_url ?? null, replaced };
}

export async function listBetabotComments(input: {
  installationId: string | number;
  fullName: string;
  pullRequestNumber: number;
  marker: string;
}): Promise<BetabotCommentSummary[]> {
  const { owner, repo } = splitFullName(input.fullName);
  const octokit = getInstallationOctokit(input.installationId);
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: input.pullRequestNumber,
    per_page: 100,
  });
  return comments
    .filter((comment) => hasMarker(comment.body, input.marker))
    .map((comment) => ({
      id: comment.id,
      body: comment.body ?? "",
      url: comment.html_url ?? null,
      author: comment.user?.login ?? null,
    }));
}
