-- Cortardo Bot memory: review rules, learnings, workspace settings and path
-- exclusions. All statements are idempotent so they can be applied to drifted
-- databases (the rules/learnings/settings tables already exist in some envs).

CREATE TABLE IF NOT EXISTS "repository_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE CASCADE,
  "glob" text,
  "instruction" text NOT NULL,
  "scope" text DEFAULT 'All repositories' NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "repository_rules_workspace_idx" ON "repository_rules" ("workspace_id");
CREATE INDEX IF NOT EXISTS "repository_rules_repository_idx" ON "repository_rules" ("repository_id");

CREATE TABLE IF NOT EXISTS "repository_learnings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE CASCADE,
  "text" text NOT NULL,
  "scope" text DEFAULT 'All repositories' NOT NULL,
  "source" text DEFAULT 'manual' NOT NULL,
  "accepted" integer DEFAULT 0 NOT NULL,
  "rejected" integer DEFAULT 0 NOT NULL,
  "finding_key" text,
  "path" text,
  "active" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "repository_learnings_workspace_idx" ON "repository_learnings" ("workspace_id");
CREATE INDEX IF NOT EXISTS "repository_learnings_repository_idx" ON "repository_learnings" ("repository_id");

CREATE TABLE IF NOT EXISTS "bot_settings" (
  "workspace_id" uuid PRIMARY KEY NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "commit_reviews" jsonb DEFAULT '{"enabled":false,"reviewDirect":false,"scanDiffs":false,"checkMessages":false,"suggestFixes":false,"autoApplySafeFixes":false,"ignoreMergeCommits":false,"ignoreReleaseCommits":false,"maxCommitsPerRun":50}'::jsonb NOT NULL,
  "settings" jsonb DEFAULT '{"instructions":"","pullRequests":{"autoReview":true,"reviewDrafts":false,"reReviewOnPush":true,"inlineComments":true,"summaryComment":true,"requestChangesOnCritical":false,"ignoreGenerated":true,"skipBotsAndForks":true,"commentLimit":20}}'::jsonb NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
ALTER TABLE "bot_settings" ADD COLUMN IF NOT EXISTS "settings" jsonb DEFAULT '{"instructions":"","pullRequests":{"autoReview":true,"reviewDrafts":false,"reReviewOnPush":true,"inlineComments":true,"summaryComment":true,"requestChangesOnCritical":false,"ignoreGenerated":true,"skipBotsAndForks":true,"commentLimit":20}}'::jsonb NOT NULL;

CREATE TABLE IF NOT EXISTS "bot_exclusions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE CASCADE,
  "repository_id" uuid REFERENCES "repositories"("id") ON DELETE CASCADE,
  "pattern" text NOT NULL,
  "note" text,
  "enabled" boolean DEFAULT true NOT NULL,
  "created_by" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);
CREATE INDEX IF NOT EXISTS "bot_exclusions_workspace_idx" ON "bot_exclusions" ("workspace_id");
CREATE INDEX IF NOT EXISTS "bot_exclusions_repository_idx" ON "bot_exclusions" ("repository_id");
