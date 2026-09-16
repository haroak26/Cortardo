/**
 * Remove stale CortadoBot review comments on haroak26/Artificial-Gateway PR7
 * so the next live E2E run publishes into a clean PR. Only comments authored
 * by the app itself are deleted; reviews cannot be deleted via the GitHub API.
 */
import { getInstallationOctokit } from "../../server/lib/github/app.ts";

const owner = "haroak26";
const repo = "Artificial-Gateway";
const pull_number = 7;

const octokit = getInstallationOctokit(161125043);
const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, { owner, repo, pull_number, per_page: 100 });

let deleted = 0;
for (const comment of comments) {
  const login = comment.user?.login ?? "";
  const isCortado = login === "cortardobot[bot]" || login.toLowerCase().includes("cortado");
  if (!isCortado) {
    console.log(`skip (not ours): comment ${comment.id} @${login} ${comment.path}:${comment.line ?? comment.original_line}`);
    continue;
  }
  try {
    await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: comment.id });
    deleted += 1;
    console.log(`deleted review comment ${comment.id} @${login} ${comment.path}:${comment.line ?? comment.original_line}`);
  } catch (error) {
    console.log(`FAILED to delete review comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const issueComments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: pull_number, per_page: 100 });
for (const comment of issueComments) {
  const login = comment.user?.login ?? "";
  const isCortado = login === "cortardobot[bot]" || login.toLowerCase().includes("cortado");
  if (!isCortado) {
    console.log(`issue comment ${comment.id} @${login} (not Cortado; left in place — app tokens can only delete their own comments)`);
    continue;
  }
  try {
    await octokit.rest.issues.deleteComment({ owner, repo, comment_id: comment.id });
    deleted += 1;
    console.log(`deleted issue comment ${comment.id} @${login}`);
  } catch (error) {
    console.log(`FAILED to delete issue comment ${comment.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
}
console.log(`done: deleted ${deleted} comment(s)`);
process.exit(0);
