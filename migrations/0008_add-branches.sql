CREATE TABLE "branches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "branches_project_name_idx" ON "branches" USING btree ("project_id","name");--> statement-breakpoint
CREATE INDEX "branches_project_idx" ON "branches" USING btree ("project_id");--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE cascade;