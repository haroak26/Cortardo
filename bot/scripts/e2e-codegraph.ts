import assert from "node:assert/strict";
import pg from "pg";
import { storage } from "../../server/storage.ts";
import { runCodegraphStage } from "../src/index.ts";
import { listCortardoBotComments } from "../src/github.ts";
import { CODEGRAPH_MARKER } from "../src/markdown.ts";

const repositoryFullName = process.env.CORTARDO_BOT_REPOSITORY ?? "haroak26/Artificial-Gateway";
const pullRequestNumber = Number(process.env.CORTARDO_BOT_PR ?? 6);
const dryRun = process.env.CORTARDO_BOT_DRY_RUN === "1";

async function resolveRepositoryId(): Promise<string> {
  if (process.env.CORTARDO_BOT_REPOSITORY_ID) return process.env.CORTARDO_BOT_REPOSITORY_ID;
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
const repository = await storage.getRepositoryById(repositoryId);
assert.ok(repository, "repository not found");
const runId = `cortardo-bot-e2e-codegraph-${Date.now().toString(36)}`;
console.log(`[cortardo-bot:e2e] repository=${repositoryFullName} (${repositoryId}) pr=#${pullRequestNumber} dryRun=${dryRun}`);

// Codegraph is internal to the pipeline; the debug check calls the stage directly.
const stage = await runCodegraphStage({
  runId,
  repository,
  pullRequestNumber,
  dryRun,
});

console.log(`[cortardo-bot:e2e] run=${runId} head=${stage.headSha.slice(0, 8)} published=${stage.commentUrl !== null}`);
console.log(`[cortardo-bot:e2e] stage summary: ${stage.summary} (${(stage.durationMs / 1000).toFixed(1)}s, ${stage.body.length} chars)`);

if (!dryRun) {
  assert.ok(repository.installationId, "repository has no installation");

  const comments = await listCortardoBotComments({
    installationId: repository.installationId,
    fullName: repository.fullName,
    pullRequestNumber,
    marker: CODEGRAPH_MARKER,
  });
  assert.equal(comments.length, 1, `expected exactly 1 codegraph comment, found ${comments.length}`);
  assert.equal(comments[0].id, stage.commentId, "live comment id does not match the published stage result");
  assert.ok(comments[0].body.includes("## Cortardo Bot · Stage 1: codegraph"), "comment is missing the stage heading");
  assert.ok(comments[0].body.includes(stage.summary), "comment is missing the stage summary");

  console.log(`[cortardo-bot:e2e] verified comment ${comments[0].id} by ${comments[0].author}: ${comments[0].url}`);
  console.log("");
  console.log(comments[0].body.split("\n").slice(0, 24).join("\n"));
  console.log("...");
}

console.log("[cortardo-bot:e2e] PASS");
