CREATE TABLE "github_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"github_user_id" text NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"access_token" text NOT NULL,
	"scopes" text,
	"token_type" text DEFAULT 'bearer',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_app_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"app_id" text NOT NULL,
	"slug" text,
	"name" text,
	"client_id" text,
	"client_secret" text,
	"private_key" text NOT NULL,
	"webhook_secret" text,
	"html_url" text,
	"owner_login" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "auth_account_id" uuid;--> statement-breakpoint
ALTER TABLE "repositories" ADD COLUMN "webhook_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "github_accounts_user_github_idx" ON "github_accounts" USING btree ("user_id","github_user_id");--> statement-breakpoint
CREATE INDEX "github_accounts_user_idx" ON "github_accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repositories_auth_account_idx" ON "repositories" USING btree ("auth_account_id");