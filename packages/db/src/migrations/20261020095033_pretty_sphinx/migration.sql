ALTER TABLE "wallet_link" DROP CONSTRAINT "wallet_link_wallet_address_key";--> statement-breakpoint
DROP INDEX "wallet_link_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_link_user_chain_idx" ON "wallet_link" ("user_id","chain_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_link_address_chain_idx" ON "wallet_link" ("chain_id","wallet_address");