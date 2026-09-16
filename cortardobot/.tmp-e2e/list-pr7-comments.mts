import { getInstallationOctokit } from "../../server/lib/github/app.ts";

const owner = "haroak26";
const repo = "Artificial-Gateway";
const pull_number = 7;
const INSTALLATION_ID = 161125043;

const octokit = getInstallationOctokit(INSTALLATION_ID);

const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number, per_page: 100 });
console.log(`\n===== REVIEWS (${reviews.length}) =====`);
for (const r of reviews) {
  console.log(`\n--- review ${r.id} @${r.user?.login} state=${r.state} at=${r.submitted_at} commit=${r.commit_id?.slice(0, 8)}`);
  console.log(r.body ?? "");
}

const reviewComments = await octokit.paginate(octokit.rest.pulls.listReviewComments, { owner, repo, pull_number, per_page: 100 });
console.log(`\n===== REVIEW COMMENTS / inline (${reviewComments.length}) =====`);
for (const c of reviewComments) {
  console.log(`\n--- comment ${c.id} review_id=${c.pull_request_review_id} @${c.user?.login} path=${c.path} line=${c.line ?? c.original_line} at=${c.created_at}`);
  console.log(`   [commit ${c.commit_id?.slice(0, 8)}]`);
  console.log(c.body);
}

const issueComments = await octokit.paginate(octokit.rest.issues.listComments, { owner, repo, issue_number: pull_number, per_page: 100 });
console.log(`\n===== ISSUE COMMENTS (${issueComments.length}) =====`);
for (const c of issueComments) {
  console.log(`\n--- issue comment ${c.id} @${c.user?.login} at=${c.created_at}`);
  console.log(c.body);
}
process.exit(0);
