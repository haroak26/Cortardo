/**
 * Learnings CLI: manage the dismissals the hypotheses stage reads before it
 * reports. Dismissing a fingerprint (the short `s_…` id printed under each
 * hypothesis) suppresses that exact finding on future runs until the change it
 * describes becomes materially different.
 *
 * Usage:
 *   npm run bot:learnings -- --repository owner/repo --list
 *   npm run bot:learnings -- --repository owner/repo --dismiss s_ab12cd34ef --reason "intentional"
 *   npm run bot:learnings -- --repository owner/repo --remove s_ab12cd34ef
 */
import pg from "pg";
import { storage } from "../../server/storage.ts";

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const repositoryFullName = arg("repository") ?? "haroak26/Artificial-Gateway";
const dismiss = arg("dismiss");
const remove = arg("remove");
const list = process.argv.includes("--list") || (!dismiss && !remove);
const reason = arg("reason") ?? "dismissed by a reviewer";
const path = arg("path");

async function resolveRepositoryId(fullName: string): Promise<string> {
  if (process.env.CORTARDO_BOT_REPOSITORY_ID) return process.env.CORTARDO_BOT_REPOSITORY_ID;
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ id: string }>("SELECT id FROM repositories WHERE full_name = $1", [fullName]);
    if (!rows[0]) throw new Error(`repository not found: ${fullName}`);
    return rows[0].id;
  } finally {
    await client.end();
  }
}

const repositoryId = await resolveRepositoryId(repositoryFullName);
const repository = await storage.getRepositoryById(repositoryId);
if (!repository) throw new Error(`repository row missing: ${repositoryId}`);

if (dismiss) {
  const row = await storage.createRepositoryLearning({
    workspaceId: repository.workspaceId,
    repositoryId: repository.id,
    text: reason,
    scope: "This repository",
    source: "manual",
    active: true,
    findingKey: dismiss,
    path: path ?? null,
  });
  console.log(`[cortardo-bot:learnings] dismissed ${dismiss} (learning ${row.id}): ${reason}`);
} else if (remove) {
  const rows = await storage.listRepositoryLearnings(repository.workspaceId, repository.id);
  const matches = rows.filter((row) => row.findingKey === remove);
  if (matches.length === 0) {
    console.error(`[cortardo-bot:learnings] no active learning for ${remove}`);
    process.exit(1);
  }
  for (const row of matches) await storage.deactivateRepositoryLearning(row.id);
  console.log(`[cortardo-bot:learnings] removed ${matches.length} learning(s) for ${remove}`);
} else if (list) {
  const rows = await storage.listRepositoryLearnings(repository.workspaceId, repository.id);
  if (rows.length === 0) {
    console.log(`[cortardo-bot:learnings] no active learnings for ${repositoryFullName}`);
  } else {
    for (const row of rows) {
      console.log(`${row.id} ${row.findingKey ?? "-"} ${row.path ?? "-"} — ${row.text}`);
    }
  }
}
