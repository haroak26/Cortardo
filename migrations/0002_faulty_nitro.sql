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
ALTER TABLE "credit_holds" ADD CONSTRAINT "credit_holds_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_credits" ADD CONSTRAINT "user_credits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_holds_user_idx" ON "credit_holds" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "credit_holds_run_idx" ON "credit_holds" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "credit_transactions_user_idx" ON "credit_transactions" USING btree ("user_id","created_at" DESC NULLS LAST);