import assert from "node:assert/strict";
import pg from "pg";
import { getInstallationOctokit } from "../../server/lib/github/app.ts";
import { listPullRequestReviewComments, splitFullName } from "../../server/lib/github/api.ts";
import { storage } from "../../server/storage.ts";
import { runCodeBot } from "../src/index.ts";
import { listCodeBotComments } from "../src/github.ts";
import { REVIEW_MARKER } from "../src/markdown.ts";
import type { FixStageResult, VerifyStageResult } from "../src/types.ts";

const repositoryFullName = process.env.CODEBOT_REPOSITORY ?? "haroak26/Artificial-Gateway";
const pullRequestNumber = Number(process.env.CODEBOT_PR ?? 7);
const dryRun = process.env.CODEBOT_DRY_RUN === "1";

async function resolveRepositoryId(): Promise<string> {
  if (process.env.CODEBOT_REPOSITORY_ID) return process.env.CODEBOT_REPOSITORY_ID;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>("SELECT id FROM repositories WHERE full_name = $1", [
      repositoryFullName,
    ]);
    if (!rows[0]) throw new Error(`repository not found: ${repositoryFullName}`);
    return rows[0].id;
  } finally {
    await client.end();
  }
}

const SUGGESTION_MARKER = "<!-- codebot:fix";

async function cleanBotConversation(installationId: string | number): Promise<number> {
  const { owner, repo } = splitFullName(repositoryFullName);
  const octokit = getInstallationOctokit(installationId);
  let deleted = 0;
  const { data: comments } = await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullRequestNumber,
    per_page: 100,
  });
  for (const comment of comments) {
    if (comment.user?.type !== "Bot") continue;
    await octokit.rest.issues.deleteComment({ owner, repo, comment_id: comment.id });
    deleted += 1;
    console.log(`[codebot:e2e:verify] removed old comment #${comment.id} by ${comment.user?.login}`);
  }
  const { data: reviews } = await octokit.rest.pulls.listReviewComments({
    owner,
    repo,
    pull_number: pullRequestNumber,
    per_page: 100,
  });
  for (const comment of reviews) {
    if (comment.user?.type !== "Bot") continue;
    await octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: comment.id });
    deleted += 1;
    console.log(`[codebot:e2e:verify] removed old review comment #${comment.id} by ${comment.user?.login}`);
  }
  return deleted;
}

const repositoryId = await resolveRepositoryId();
const repository = await storage.getRepositoryById(repositoryId);
assert.ok(repository?.installationId, "repository has no GitHub installation");

console.log(
  `[codebot:e2e:verify] repository=${repositoryFullName} (${repositoryId}) pr=#${pullRequestNumber} ` +
    `dryRun=${dryRun} verifyAttempts=${process.env.CODEBOT_VERIFY_ATTEMPTS ?? "4"} ` +
    `maxCost=$${process.env.CODEBOT_MAX_COST_USD ?? "0.50"}`,
);

if (!dryRun) {
  const removed = await cleanBotConversation(repository.installationId);
  console.log(`[codebot:e2e:verify] conversation is clean (${removed} old bot artifact(s) removed)`);
}

const result = await runCodeBot({
  repositoryId,
  pullRequestNumber,
  stages: ["hypotheses", "fixes", "verify"],
  dryRun,
});

const fixesStage = result.stages.find((stage) => stage.stage === "fixes") as FixStageResult | undefined;
const verifyStage = result.stages.find((stage) => stage.stage === "verify") as VerifyStageResult | undefined;
assert.ok(fixesStage, "fixes stage did not run");
assert.ok(verifyStage, "verify stage did not run");

const fixReport = fixesStage.report;
const verifyReport = verifyStage.report;
console.log(
  `[codebot:e2e:verify] run=${result.runId} head=${result.headSha.slice(0, 8)} published=${result.published}`,
);
console.log(
  `[codebot:e2e:verify] fixes: ${fixReport.totals.generated} generated · ${fixReport.totals.filtered ?? 0} filtered by severity · ` +
    `$${fixReport.usage.totalCostUsd.toFixed(4)}`,
);
console.log(
  `[codebot:e2e:verify] verify: ${verifyReport.totals.verified}/${verifyReport.totals.eligible} verified · ` +
    `${verifyReport.totals.attempts} attempt(s) · sandbox=${verifyReport.sandbox.id ?? "none"} · ` +
    `$${verifyReport.usage.totalCostUsd.toFixed(4)} of $${verifyReport.usage.maxCostUsd.toFixed(2)}`,
);
for (const fix of verifyReport.fixes) {
  console.log(
    `[codebot:e2e:verify]   ${fix.status.toUpperCase()} ${fix.hypothesisId} (${fix.evidence}) attempts=${fix.attemptsUsed}` +
      (fix.reason ? ` — ${fix.reason}` : ""),
  );
}

assert.ok(fixReport.totals.generated >= 1, "no priority fix was generated");
assert.ok(verifyReport.totals.eligible >= 1, "no priority fix was handed to verification");
assert.ok(verifyReport.totals.verified >= 1, "no fix passed sandbox verification");
assert.ok(verifyReport.sandbox.id, "verify stage did not use a sandbox");
assert.ok(result.body.includes("## CodeBot review"), "the published body is not the single review comment");
assert.ok(result.body.includes("### Verified fixes"), "the review omits the verified fixes section");
assert.ok(!result.body.includes("codegraph"), "the review must not mention codegraph");
assert.ok(
  verifyReport.fixes.some((fix) => fix.evidence === "reproduction" || fix.evidence === "probe" || fix.evidence === "tests" || fix.evidence === "compile"),
  "a verified fix has no evidence class",
);
assert.ok(
  verifyReport.usage.totalCostUsd <= verifyReport.usage.maxCostUsd,
  `run cost $${verifyReport.usage.totalCostUsd} exceeded the $${verifyReport.usage.maxCostUsd} budget`,
);

if (!dryRun) {
  const { owner, repo } = splitFullName(repository.fullName);
  const octokit = getInstallationOctokit(repository.installationId);
  const botComments = (await octokit.rest.issues.listComments({
    owner,
    repo,
    issue_number: pullRequestNumber,
    per_page: 100,
  })).data.filter((comment) => comment.user?.type === "Bot");
  assert.equal(botComments.length, 1, `the run must leave exactly 1 bot comment, found ${botComments.length}`);
  assert.equal(botComments[0].id, result.commentId, "the surviving bot comment is not the run's review");

  const review = await listCodeBotComments({
    installationId: repository.installationId,
    fullName: repository.fullName,
    pullRequestNumber,
    marker: REVIEW_MARKER,
  });
  assert.equal(review.length, 1, "expected exactly 1 review comment");
  assert.equal(review[0].id, result.commentId, "review comment id does not match the run result");

  const reviewComments = await listPullRequestReviewComments(
    repository.installationId,
    repository.fullName,
    pullRequestNumber,
  );
  for (const comment of reviewComments) {
    assert.ok(comment.body.includes(SUGGESTION_MARKER), `review comment #${comment.id} is not a CodeBot suggestion`);
    assert.ok(comment.body.includes("CodeBot verified fix"), `suggestion #${comment.id} is not marked verified`);
  }
  assert.equal(
    reviewComments.length,
    verifyReport.suggestions.posted,
    "posted suggestions do not match the verify report",
  );

  if (reviewComments.length > 0 && result.commentId !== null && reviewComments[0].reviewId !== null) {
    const [{ data: issueComment }, { data: suggestionReview }] = await Promise.all([
      octokit.rest.issues.getComment({ owner, repo, comment_id: result.commentId }),
      octokit.rest.pulls.getReview({
        owner,
        repo,
        pull_number: pullRequestNumber,
        review_id: reviewComments[0].reviewId,
      }),
    ]);
    assert.ok(
      new Date(issueComment.created_at).getTime() <= new Date(suggestionReview.submitted_at ?? issueComment.created_at).getTime(),
      "the review comment must be published before the suggestion review",
    );
  }

  console.log(
    `[codebot:e2e:verify] conversation verified: review=${review[0].id} published before ${reviewComments.length} suggestion(s)`,
  );
  console.log("");
  console.log(review[0].body.split("\n").slice(0, 45).join("\n"));
  console.log("...");
}

console.log("[codebot:e2e:verify] PASS");
