ALTER TABLE "bounty" ADD COLUMN "escrow_address" text;--> statement-breakpoint

-- Existing Sepolia bounties were created on the pre-x402 escrow deployment.
-- Preserve their historical contract so reads and receipts never drift to the
-- current deployment after a contract rotation.
UPDATE "bounty"
SET "escrow_address" = '0x19B6944FB4748831D1B8462dDbD53F32655E1AF7'
WHERE "escrow_address" IS NULL
  AND "chain_id" = 421614
  AND "onchain_bounty_id" IS NOT NULL;--> statement-breakpoint
