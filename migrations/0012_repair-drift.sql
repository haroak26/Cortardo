CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "code_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"src_id" uuid NOT NULL,
	"dst_id" uuid,
	"kind" text NOT NULL,
	"target_name" text,
	"target_file" text,
	"line" integer
);
--> statement-breakpoint
CREATE TABLE "code_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"commit_sha" text NOT NULL,
	"language" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"qualified_name" text,
	"file_path" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"signature" text,
	"parent_id" uuid,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"review_run_id" uuid NOT NULL,
	"repository_id" uuid,
	"file_path" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"side" text DEFAULT 'RIGHT' NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'bug' NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"suggestion" jsonb,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"provider_comment_id" text,
	"dedupe_key" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"author" text,
	"base_ref" text NOT NULL,
	"head_ref" text NOT NULL,
	"base_sha" text NOT NULL,
	"head_sha" text NOT NULL,
	"state" text DEFAULT 'open' NOT NULL,
	"url" text,
	"additions" integer,
	"deletions" integer,
	"changed_files" integer,
	"provider_data" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repositories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"external_id" text,
	"full_name" text NOT NULL,
	"default_branch" text DEFAULT 'main' NOT NULL,
	"clone_url" text,
	"installation_id" text,
	"is_private" boolean DEFAULT true NOT NULL,
	"review_enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"indexed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_learnings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repository_id" uuid,
	"scope" text DEFAULT 'repo' NOT NULL,
	"text" text NOT NULL,
	"source" text DEFAULT 'feedback' NOT NULL,
	"accepted_count" integer DEFAULT 0 NOT NULL,
	"rejected_count" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repository_id" uuid,
	"glob" text,
	"instruction" text NOT NULL,
	"source" text DEFAULT 'dashboard' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid,
	"pull_request_id" uuid,
	"project_id" uuid,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"title" text,
	"instructions" text,
	"model" text,
	"reasoning" text,
	"base_sha" text,
	"head_sha" text,
	"plan" jsonb,
	"overview" text,
	"summary" text,
	"walkthrough" jsonb,
	"stats" jsonb,
	"tokens_in" integer DEFAULT 0 NOT NULL,
	"tokens_out" integer DEFAULT 0 NOT NULL,
	"credits_held" real DEFAULT 0 NOT NULL,
	"credits_settled" real DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp,
	"finished_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"event" text NOT NULL,
	"delivery_id" text,
	"payload_hash" text,
	"status" text DEFAULT 'received' NOT NULL,
	"error" text,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "kind" text DEFAULT 'cortardo' NOT NULL;--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_src_id_code_nodes_id_fk" FOREIGN KEY ("src_id") REFERENCES "public"."code_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_edges" ADD CONSTRAINT "code_edges_dst_id_code_nodes_id_fk" FOREIGN KEY ("dst_id") REFERENCES "public"."code_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "code_nodes" ADD CONSTRAINT "code_nodes_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_review_run_id_review_runs_id_fk" FOREIGN KEY ("review_run_id") REFERENCES "public"."review_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_learnings" ADD CONSTRAINT "review_learnings_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_rules" ADD CONSTRAINT "review_rules_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_pull_request_id_pull_requests_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_runs" ADD CONSTRAINT "review_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "branches_project_name_idx" ON "branches" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "branches_project_idx" ON "branches" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "code_edges_src_idx" ON "code_edges" USING btree ("src_id","kind");--> statement-breakpoint
CREATE INDEX "code_edges_dst_idx" ON "code_edges" USING btree ("dst_id","kind");--> statement-breakpoint
CREATE INDEX "code_edges_repo_commit_idx" ON "code_edges" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE INDEX "code_nodes_repo_commit_idx" ON "code_nodes" USING btree ("repository_id","commit_sha");--> statement-breakpoint
CREATE INDEX "code_nodes_file_idx" ON "code_nodes" USING btree ("repository_id","commit_sha","file_path");--> statement-breakpoint
CREATE INDEX "code_nodes_name_idx" ON "code_nodes" USING btree ("repository_id","commit_sha","name");--> statement-breakpoint
CREATE INDEX "findings_run_idx" ON "findings" USING btree ("review_run_id");--> statement-breakpoint
CREATE INDEX "findings_repository_idx" ON "findings" USING btree ("repository_id","file_path");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_requests_repo_number_idx" ON "pull_requests" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "pull_requests_repository_idx" ON "pull_requests" USING btree ("repository_id","state");--> statement-breakpoint
CREATE INDEX "repositories_workspace_idx" ON "repositories" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repositories_provider_full_name_idx" ON "repositories" USING btree ("provider","full_name");--> statement-breakpoint
CREATE INDEX "review_learnings_workspace_idx" ON "review_learnings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "review_rules_workspace_idx" ON "review_rules" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "review_runs_repository_idx" ON "review_runs" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE INDEX "review_runs_project_idx" ON "review_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "review_runs_user_idx" ON "review_runs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_delivery_idx" ON "webhook_deliveries" USING btree ("provider","delivery_id");