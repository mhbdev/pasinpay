CREATE TABLE "x402_funding_payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bounty_id" uuid NOT NULL,
	"payer_wallet" text NOT NULL,
	"authorization_nonce" text NOT NULL,
	"payload_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"transaction_hash" text,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "x402_funding_nonce_idx" ON "x402_funding_payment" ("payer_wallet","authorization_nonce");--> statement-breakpoint
CREATE INDEX "x402_funding_bounty_idx" ON "x402_funding_payment" ("bounty_id");--> statement-breakpoint
CREATE INDEX "x402_funding_status_idx" ON "x402_funding_payment" ("status");--> statement-breakpoint
ALTER TABLE "x402_funding_payment" ADD CONSTRAINT "x402_funding_payment_bounty_id_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "bounty"("id") ON DELETE CASCADE;