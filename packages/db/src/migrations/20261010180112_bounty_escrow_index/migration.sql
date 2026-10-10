DROP INDEX "bounty_chain_id_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_chain_escrow_id_idx" ON "bounty" ("chain_id","escrow_address","onchain_bounty_id");