import { sql } from "drizzle-orm";
import { db } from "../../db";

/**
 * Idempotent runtime schema guard for the 3.1 review tables. `drizzle-kit
 * push`/`migrate` also applies these, but envs with drifted schemas (see
 * 0015_fix_schema_drift) still work because every statement is IF NOT EXISTS.
 */
let ensured: Promise<void> | undefined;

export function ensureReviewSchema(): Promise<void> {
  ensured ??= (async () => {
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "head_sha" text`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "engine_version" text`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "lease_owner" text`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "pull_request_number" integer`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "lease_generation" integer DEFAULT 0 NOT NULL`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "publish_state" text DEFAULT 'pending' NOT NULL`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "publish_attempts" integer DEFAULT 0 NOT NULL`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "publish_error" text`);
    await db.execute(sql`ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "published_review_id" text`);
    await db.execute(
      sql`CREATE UNIQUE INDEX IF NOT EXISTS "review_runs_active_head_idx" ON "review_runs" ("repository_id", "head_sha", "engine_version") WHERE "status" in ('queued','running')`,
    );
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "review_runs_publish_state_idx" ON "review_runs" ("publish_state")`);
    // The unique index enforces finding idempotency; if drifted duplicates exist
    // the CREATE fails, so dedupe first (same statement as migration 0019).
    await db.execute(sql`
      DELETE FROM "review_findings" a
        USING "review_findings" b
        WHERE a.ctid < b.ctid AND a."run_id" = b."run_id" AND a."finding_key" = b."finding_key"
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "review_findings_run_key_idx" ON "review_findings" ("run_id", "finding_key")`);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "review_cache_entries" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "cache_key" text NOT NULL,
        "kind" text NOT NULL,
        "engine_version" text,
        "prompt_version" text,
        "tool_version" text,
        "model_id" text,
        "repo_full_name" text,
        "head_sha" text,
        "payload" jsonb,
        "meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
        "hits" integer DEFAULT 0 NOT NULL,
        "expires_at" timestamp,
        "created_at" timestamp DEFAULT now() NOT NULL,
        "updated_at" timestamp DEFAULT now() NOT NULL
      )
    `);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS "review_cache_entries_cache_key_idx" ON "review_cache_entries" ("cache_key")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "review_cache_kind_idx" ON "review_cache_entries" ("kind")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "review_cache_repo_idx" ON "review_cache_entries" ("repo_full_name")`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "review_cache_expires_idx" ON "review_cache_entries" ("expires_at")`);
  })().catch((error) => {
    ensured = undefined;
    throw error;
  });
  return ensured;
}
