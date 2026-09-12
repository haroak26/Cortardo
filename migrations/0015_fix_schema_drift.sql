CREATE TABLE "activity_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"project_id" uuid,
	"design_file_id" uuid,
	"action" text NOT NULL,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"design_file_id" uuid,
	"uploader_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'image' NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"size" integer DEFAULT 0 NOT NULL,
	"mime_type" text,
	"width" integer,
	"height" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "canvases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_file_id" uuid NOT NULL,
	"name" text DEFAULT 'Canvas 1' NOT NULL,
	"order_index" integer DEFAULT 0 NOT NULL,
	"background_color" text DEFAULT '#ffffff' NOT NULL,
	"width" integer DEFAULT 1440 NOT NULL,
	"height" integer DEFAULT 900 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comment_replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"comment_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_file_id" uuid NOT NULL,
	"canvas_id" uuid,
	"layer_id" uuid,
	"author_id" uuid NOT NULL,
	"body" text NOT NULL,
	"x" real,
	"y" real,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by_id" uuid,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "component_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"component_set_id" uuid,
	"design_file_id" uuid,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'component' NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"thumbnail_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "components_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "credit_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"run_id" uuid,
	"amount" real NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"amount" real NOT NULL,
	"balance_after" real NOT NULL,
	"description" text,
	"metadata" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"public_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'design' NOT NULL,
	"description" text,
	"thumbnail_url" text,
	"canvas_width" integer DEFAULT 1440 NOT NULL,
	"canvas_height" integer DEFAULT 900 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"is_favorited" boolean DEFAULT false NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_files_public_id_unique" UNIQUE("public_id")
);
--> statement-breakpoint
CREATE TABLE "design_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_file_id" uuid NOT NULL,
	"share_token" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"password" text,
	"expires_at" timestamp,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "design_shares_share_token_unique" UNIQUE("share_token")
);
--> statement-breakpoint
CREATE TABLE "design_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"category" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "design_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_file_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"data" jsonb NOT NULL,
	"description" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "export_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"format" text DEFAULT 'png' NOT NULL,
	"scale" real DEFAULT 1 NOT NULL,
	"suffix" text DEFAULT '',
	"quality" integer DEFAULT 100,
	"include_background" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" text NOT NULL,
	"account_login" text,
	"account_type" text,
	"repository_selection" text DEFAULT 'selected',
	"suspended_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "layers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"design_file_id" uuid NOT NULL,
	"canvas_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text DEFAULT 'Layer' NOT NULL,
	"type" text DEFAULT 'rectangle' NOT NULL,
	"x" real DEFAULT 0 NOT NULL,
	"y" real DEFAULT 0 NOT NULL,
	"width" real DEFAULT 100 NOT NULL,
	"height" real DEFAULT 100 NOT NULL,
	"rotation" real DEFAULT 0 NOT NULL,
	"opacity" real DEFAULT 1 NOT NULL,
	"visible" boolean DEFAULT true NOT NULL,
	"locked" boolean DEFAULT false NOT NULL,
	"z_index" integer DEFAULT 0 NOT NULL,
	"properties" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"styles" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"export_settings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"component_id" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"read" boolean DEFAULT false NOT NULL,
	"design_file_id" uuid,
	"project_id" uuid,
	"comment_id" uuid,
	"actor_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugin_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plugin_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installed_by" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon_url" text,
	"manifest" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "plugins_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'editor' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_file_trees" (
	"repository_id" uuid PRIMARY KEY NOT NULL,
	"commit_sha" text NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"file_count" integer DEFAULT 0 NOT NULL,
	"refreshed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_credits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"balance" real DEFAULT 0 NOT NULL,
	"lifetime_purchased" real DEFAULT 0 NOT NULL,
	"lifetime_used" real DEFAULT 0 NOT NULL,
	"daily_used" real DEFAULT 0 NOT NULL,
	"daily_reset_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_credits_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"user_agent" text,
	"browser" text,
	"os" text,
	"device" text,
	"ip_address" text,
	"location" text,
	"is_current" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_design_file_id_design_files_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_files"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "canvases" ADD CONSTRAINT "canvases_design_file_id_design_files_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comment_replies" ADD CONSTRAINT "comment_replies_comment_id_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."comments"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_design_file_id_design_files_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_layer_id_layers_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."layers"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_component_set_id_component_sets_id_fk" FOREIGN KEY ("component_set_id") REFERENCES "public"."component_sets"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "components" ADD CONSTRAINT "components_design_file_id_design_files_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "design_files" ADD CONSTRAINT "design_files_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "design_shares" ADD CONSTRAINT "design_shares_design_file_id_design_files_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "design_versions" ADD CONSTRAINT "design_versions_design_file_id_design_files_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_design_file_id_design_files_id_fk" FOREIGN KEY ("design_file_id") REFERENCES "public"."design_files"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "layers" ADD CONSTRAINT "layers_canvas_id_canvases_id_fk" FOREIGN KEY ("canvas_id") REFERENCES "public"."canvases"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "plugin_installations" ADD CONSTRAINT "plugin_installations_plugin_id_plugins_id_fk" FOREIGN KEY ("plugin_id") REFERENCES "public"."plugins"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "repository_file_trees" ADD CONSTRAINT "repository_file_trees_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repositories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "activity_logs_workspace_idx" ON "activity_logs" USING btree ("workspace_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "activity_logs_design_file_idx" ON "activity_logs" USING btree ("design_file_id");
--> statement-breakpoint
CREATE INDEX "assets_workspace_idx" ON "assets" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "assets_design_file_idx" ON "assets" USING btree ("design_file_id");
--> statement-breakpoint
CREATE INDEX "canvases_design_file_idx" ON "canvases" USING btree ("design_file_id","order_index");
--> statement-breakpoint
CREATE INDEX "comment_replies_comment_idx" ON "comment_replies" USING btree ("comment_id");
--> statement-breakpoint
CREATE INDEX "comments_design_file_idx" ON "comments" USING btree ("design_file_id","created_at");
--> statement-breakpoint
CREATE INDEX "comments_canvas_idx" ON "comments" USING btree ("canvas_id");
--> statement-breakpoint
CREATE INDEX "component_sets_workspace_idx" ON "component_sets" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "components_workspace_idx" ON "components" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "components_set_idx" ON "components" USING btree ("component_set_id");
--> statement-breakpoint
CREATE INDEX "credit_holds_user_idx" ON "credit_holds" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "credit_holds_run_idx" ON "credit_holds" USING btree ("run_id");
--> statement-breakpoint
CREATE INDEX "credit_transactions_user_idx" ON "credit_transactions" USING btree ("user_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "design_files_project_idx" ON "design_files" USING btree ("project_id","is_archived");
--> statement-breakpoint
CREATE INDEX "design_files_workspace_idx" ON "design_files" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "design_shares_file_idx" ON "design_shares" USING btree ("design_file_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "design_token_name_type_idx" ON "design_tokens" USING btree ("workspace_id","name","type");
--> statement-breakpoint
CREATE UNIQUE INDEX "design_version_unique" ON "design_versions" USING btree ("design_file_id","version_number");
--> statement-breakpoint
CREATE INDEX "export_presets_workspace_idx" ON "export_presets" USING btree ("workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "github_installations_installation_idx" ON "github_installations" USING btree ("installation_id");
--> statement-breakpoint
CREATE INDEX "github_installations_workspace_idx" ON "github_installations" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "layers_canvas_idx" ON "layers" USING btree ("canvas_id","z_index");
--> statement-breakpoint
CREATE INDEX "layers_parent_idx" ON "layers" USING btree ("parent_id");
--> statement-breakpoint
CREATE INDEX "layers_design_file_idx" ON "layers" USING btree ("design_file_id");
--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","read","created_at" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "plugin_install_unique" ON "plugin_installations" USING btree ("plugin_id","workspace_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "project_member_idx" ON "project_members" USING btree ("project_id","user_id");
--> statement-breakpoint
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" USING btree ("user_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "user_sessions_session_id_idx" ON "user_sessions" USING btree ("session_id");
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "storage_used" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "projects_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "design_files_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "version_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage" ADD COLUMN "component_count" integer DEFAULT 0 NOT NULL;
