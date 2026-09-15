-- CortardoBot 3.1: review-run leases, cache infrastructure and idempotency keys.
-- All statements are idempotent so they can be applied to drifted databases.

ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "head_sha" text;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "engine_version" text;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "lease_owner" text;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "lease_expires_at" timestamp;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "heartbeat_at" timestamp;

CREATE UNIQUE INDEX IF NOT EXISTS "review_runs_active_head_idx"
  ON "review_runs" ("repository_id", "head_sha", "engine_version")
  WHERE "status" in ('queued', 'running');

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
);

CREATE UNIQUE INDEX IF NOT EXISTS "review_cache_entries_cache_key_idx" ON "review_cache_entries" ("cache_key");
CREATE INDEX IF NOT EXISTS "review_cache_kind_idx" ON "review_cache_entries" ("kind");
CREATE INDEX IF NOT EXISTS "review_cache_repo_idx" ON "review_cache_entries" ("repo_full_name");
CREATE INDEX IF NOT EXISTS "review_cache_expires_idx" ON "review_cache_entries" ("expires_at");
