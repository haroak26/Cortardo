CREATE TABLE "agent_component_registry" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'shared' NOT NULL,
	"spec" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contract" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"source_hash" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'validated' NOT NULL,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_project_state" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"intake" jsonb,
	"product_spec" jsonb,
	"design_system" jsonb,
	"architecture" jsonb,
	"style_seed" text,
	"decision_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"artifact_hashes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "agent_component_registry" ADD CONSTRAINT "agent_component_registry_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD CONSTRAINT "agent_project_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_component_registry_project_name_idx" ON "agent_component_registry" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "agent_component_registry_project_idx" ON "agent_component_registry" USING btree ("project_id");