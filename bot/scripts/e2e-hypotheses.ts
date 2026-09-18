import assert from "node:assert/strict";
import pg from "pg";
import { storage } from "../../server/storage.ts";
import { runCodeBot } from "../src/index.ts";
import { listCodeBotComments } from "../src/github.ts";
import { CODEGRAPH_MARKER, REVIEW_MARKER } from "../src/markdown.ts";

const repositoryFullName = process.env.CODEBOT_REPOSITORY ?? "haroak26/Artificial-Gateway";
const pullRequestNumber = Number(process.env.CODEBOT_PR ?? 6);
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
  `[codebot:e2e:hypotheses] repository=${repositoryFullName} (${repositoryId}) pr=#${pullRequestNumber} ` +
    `dryRun=${dryRun} noModel=${process.env.CODEBOT_NO_MODEL === "1"}`,
);

const result = await runCodeBot({
  repositoryId,
  pullRequestNumber,
  stages: ["hypotheses"],
  dryRun,
});

const stage = result.stages[0];
assert.ok(stage, "hypotheses stage did not run");
console.log(`[codebot:e2e:hypotheses] run=${result.runId} head=${result.headSha.slice(0, 8)} published=${result.published}`);
console.log(
  `[codebot:e2e:hypotheses] stage summary: ${stage.summary} (${(stage.durationMs / 1000).toFixed(1)}s, ` +
    `${result.body.length} review chars)`,
);
assert.ok(result.body.includes("## CodeBot review"), "review is missing the heading");
assert.ok(result.body.includes("### Findings"), "review is missing the findings section");
assert.ok(result.body.includes("unproven advisories"), "review is missing the advisory disclaimer");

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
  assert.ok(comments[0].body.includes("## CodeBot review"), "comment is missing the review heading");

  const codegraphComments = await listCodeBotComments({
    installationId: repository.installationId,
    fullName: repository.fullName,
    pullRequestNumber,
    marker: CODEGRAPH_MARKER,
  });
  assert.equal(codegraphComments.length, 0, "codegraph must never be published");

  console.log(`[codebot:e2e:hypotheses] verified comment ${comments[0].id} by ${comments[0].author}: ${comments[0].url}`);
  console.log("");
  console.log(comments[0].body.split("\n").slice(0, 30).join("\n"));
  console.log("...");
}

console.log("[codebot:e2e:hypotheses] PASS");
