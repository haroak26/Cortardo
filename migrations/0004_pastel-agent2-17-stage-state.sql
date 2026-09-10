CREATE EXTENSION IF NOT EXISTS "vector";--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "creative_brief" jsonb;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "brand_strategy" jsonb;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "information_architecture" jsonb;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "user_flow_plan" jsonb;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "screen_plan" jsonb;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "layout_plan" jsonb;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "pattern_context" jsonb;--> statement-breakpoint
ALTER TABLE "agent_project_state" ADD COLUMN "interaction_plan" jsonb;--> statement-breakpoint
CREATE TABLE "design_patterns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"structure" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"best_for" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(1536),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "design_patterns_name_idx" ON "design_patterns" USING btree ("name");--> statement-breakpoint
CREATE INDEX "design_patterns_category_idx" ON "design_patterns" USING btree ("category");
