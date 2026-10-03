ALTER TABLE "bounty" ADD COLUMN "chain_id" integer DEFAULT 421614 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bounty" ADD COLUMN "issue_title" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bounty" ADD COLUMN "issue_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "bounty" ADD COLUMN "creation_mode" text DEFAULT 'existing' NOT NULL;
--> statement-breakpoint
CREATE INDEX "bounty_chain_status_idx" ON "bounty" ("chain_id", "status");
