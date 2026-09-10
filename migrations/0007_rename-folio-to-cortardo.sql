ALTER TABLE "folio_runs" RENAME TO "cortardo_agent_runs";--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "kind" SET DEFAULT 'cortardo';--> statement-breakpoint
UPDATE "projects" SET "kind" = 'cortardo' WHERE "kind" = 'folio';
