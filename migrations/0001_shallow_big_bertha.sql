CREATE TABLE "agent_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"kind" text DEFAULT 'brief' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"path" text NOT NULL,
	"kind" text DEFAULT 'component' NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"user_id" uuid,
	"prompt" text NOT NULL,
	"answers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"title" text,
	"status" text DEFAULT 'running' NOT NULL,
	"phase" text,
	"error" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_documents" ADD CONSTRAINT "agent_documents_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_files" ADD CONSTRAINT "agent_files_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_documents_run_path_idx" ON "agent_documents" USING btree ("run_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_files_run_path_idx" ON "agent_files" USING btree ("run_id","path");--> statement-breakpoint
CREATE INDEX "agent_runs_project_idx" ON "agent_runs" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_runs_user_idx" ON "agent_runs" USING btree ("user_id","created_at");