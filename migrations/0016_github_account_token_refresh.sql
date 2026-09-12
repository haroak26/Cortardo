ALTER TABLE "github_accounts" ADD COLUMN "refresh_token" text;--> statement-breakpoint
ALTER TABLE "github_accounts" ADD COLUMN "token_expires_at" timestamp;
