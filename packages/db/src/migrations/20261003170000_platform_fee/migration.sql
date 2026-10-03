ALTER TABLE "bounty" ADD COLUMN "fee_amount" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "bounty" ADD COLUMN "total_funded" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "settlement" ADD COLUMN "fee_amount" bigint DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE "bounty" SET "total_funded" = "amount" WHERE "total_funded" = 0;
