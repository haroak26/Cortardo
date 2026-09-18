import assert from "node:assert/strict";
import pg from "pg";
import { storage } from "../../server/storage.ts";
import { runCodeBot } from "../src/index.ts";
import { listCodeBotComments } from "../src/github.ts";
import { listPullRequestReviewComments } from "../../server/lib/github/api.ts";
import { REVIEW_MARKER } from "../src/markdown.ts";
import type { FixStageResult } from "../src/types.ts";

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

const repositoryId = await resolveRepositoryId();
console.log(
  `[codebot:e2e:fixes] repository=${repositoryFullName} (${repositoryId}) pr=#${pullRequestNumber} ` +
    `dryRun=${dryRun} maxFixes=${process.env.CODEBOT_MAX_FIXES ?? "0"} maxCost=$${process.env.CODEBOT_MAX_COST_USD ?? "0.50"}`,
);

const result = await runCodeBot({
  repositoryId,
  pullRequestNumber,
  stages: ["hypotheses", "fixes"],
  dryRun,
});

const stage = result.stages.find((entry) => entry.stage === "fixes") as FixStageResult | undefined;
assert.ok(stage, "fixes stage did not run");
console.log(`[codebot:e2e:fixes] run=${result.runId} head=${result.headSha.slice(0, 8)} published=${result.published}`);
console.log(`[codebot:e2e:fixes] stage summary: ${stage.summary} (${(stage.durationMs / 1000).toFixed(1)}s)`);
assert.ok(result.body.includes("## CodeBot review"), "review is missing the heading");
assert.ok(result.body.includes("### Findings"), "review is missing the findings section");
assert.ok(result.body.includes("Only the verified fixes are offered as inline suggestions"), "review is missing the suggestion disclaimer");

if (!dryRun) {
  const repository = await storage.getRepositoryById(repositoryId);
  assert.ok(repository?.installationId, "repository has no installation");

  const comments = await listCodeBotComments({
    installationId: repository.installationId,
    fullName: repository.fullName,
    pullRequestNumber,
    marker: REVIEW_MARKER,
  });
  assert.equal(comments.length, 1, `expected exactly 1 review comment, found ${comments.length}`);
  assert.equal(comments[0].id, result.commentId, "live comment id does not match the run result");

  const reviewComments = await listPullRequestReviewComments(
    repository.installationId,
    repository.fullName,
    pullRequestNumber,
  );
  for (const comment of reviewComments) {
    assert.ok(comment.body.includes("<!-- codebot:fix"), `review comment #${comment.id} is not a CodeBot suggestion`);
    assert.ok(comment.body.includes("CodeBot draft fix"), "without verification the suggestions are drafts");
  }
  assert.equal(
    reviewComments.length,
    stage.report.suggestions.posted,
    "posted suggestions do not match the fixes report",
  );

  console.log(`[codebot:e2e:fixes] verified review ${comments[0].id} by ${comments[0].author}: ${comments[0].url}`);
  console.log(`[codebot:e2e:fixes] ${reviewComments.length} draft suggestion(s) posted`);
  console.log("");
  console.log(comments[0].body.split("\n").slice(0, 40).join("\n"));
  console.log("...");
}

console.log("[codebot:e2e:fixes] PASS");
