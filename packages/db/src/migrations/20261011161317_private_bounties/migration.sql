CREATE TABLE "bounty_join_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bounty_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"failed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounty_participant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bounty_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"github_account_id" text NOT NULL,
	"joined_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bounty" ADD COLUMN "joining_password_salt" text;--> statement-breakpoint
ALTER TABLE "bounty" ADD COLUMN "joining_password_hash" text;--> statement-breakpoint
CREATE INDEX "bounty_join_attempt_user_idx" ON "bounty_join_attempt" ("bounty_id","user_id","failed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_participant_user_idx" ON "bounty_participant" ("bounty_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_participant_github_idx" ON "bounty_participant" ("bounty_id","github_account_id");--> statement-breakpoint
ALTER TABLE "bounty_join_attempt" ADD CONSTRAINT "bounty_join_attempt_bounty_id_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "bounty"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bounty_join_attempt" ADD CONSTRAINT "bounty_join_attempt_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bounty_participant" ADD CONSTRAINT "bounty_participant_bounty_id_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "bounty"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "bounty_participant" ADD CONSTRAINT "bounty_participant_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;