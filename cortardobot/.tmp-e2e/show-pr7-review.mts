import { getInstallationOctokit } from "../../server/lib/github/app.ts";

const owner = "haroak26";
const repo = "Artificial-Gateway";
const pull_number = 7;
const REVIEW_ID = Number(process.argv[2] ?? 0);

const octokit = getInstallationOctokit(161125043);
const { data: review } = await octokit.rest.pulls.getReview({ owner, repo, pull_number, review_id: REVIEW_ID });
console.log(`review ${review.id} @${review.user?.login} state=${review.state} at=${review.submitted_at} commit=${review.commit_id?.slice(0, 8)}`);
console.log("----- BODY -----");
console.log(review.body ?? "");

const comments = await octokit.paginate(octokit.rest.pulls.listReviewComments, { owner, repo, pull_number, per_page: 100 });
const mine = comments.filter((c) => c.pull_request_review_id === REVIEW_ID);
console.log(`\n----- INLINE COMMENTS (${mine.length}) -----`);
for (const c of mine) {
  console.log(`\n--- ${c.id} ${c.path}:${c.line ?? c.original_line}`);
  console.log(c.body);
}

const reviews = await octokit.paginate(octokit.rest.pulls.listReviews, { owner, repo, pull_number, per_page: 100 });
console.log(`\n----- ALL REVIEW STATES -----`);
for (const r of reviews) console.log(`review ${r.id} @${r.user?.login} state=${r.state} at=${r.submitted_at}`);
process.exit(0);
