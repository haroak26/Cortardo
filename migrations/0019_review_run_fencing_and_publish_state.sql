-- CortardoBot 3.3: fenced run lifecycle, publish state and finding idempotency.
-- All statements are idempotent so they can be applied to drifted databases.

ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "pull_request_number" integer;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "lease_generation" integer DEFAULT 0 NOT NULL;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "publish_state" text DEFAULT 'pending' NOT NULL;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "publish_attempts" integer DEFAULT 0 NOT NULL;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "publish_error" text;
ALTER TABLE "review_runs" ADD COLUMN IF NOT EXISTS "published_review_id" text;

CREATE INDEX IF NOT EXISTS "review_runs_publish_state_idx" ON "review_runs" ("publish_state");

-- One finding row per run + candidate; replays update instead of duplicating.
DELETE FROM "review_findings" a
  USING "review_findings" b
  WHERE a.ctid < b.ctid AND a."run_id" = b."run_id" AND a."finding_key" = b."finding_key";

CREATE UNIQUE INDEX IF NOT EXISTS "review_findings_run_key_idx" ON "review_findings" ("run_id", "finding_key");
