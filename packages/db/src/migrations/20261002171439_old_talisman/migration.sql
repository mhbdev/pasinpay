CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY,
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bounty" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"onchain_bounty_id" bigint,
	"creator_wallet" text NOT NULL,
	"repository" text NOT NULL,
	"repository_hash" text NOT NULL,
	"issue_number" integer NOT NULL,
	"title" text NOT NULL,
	"amount" bigint NOT NULL,
	"deadline" timestamp NOT NULL,
	"review_window_seconds" integer NOT NULL,
	"review_ends" timestamp,
	"claimant_wallet" text,
	"claim_digest" text,
	"status" text DEFAULT 'Open' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chain_cursor" (
	"id" text PRIMARY KEY,
	"chain_id" integer NOT NULL,
	"last_block" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "claim" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bounty_id" uuid NOT NULL,
	"github_pr_number" integer NOT NULL,
	"merge_commit_sha" text NOT NULL,
	"claimant_wallet" text NOT NULL,
	"attestation_digest" text NOT NULL UNIQUE,
	"attestation_signature" text NOT NULL,
	"attestation_nonce" bigint DEFAULT 0 NOT NULL,
	"attestation_expires_at" timestamp DEFAULT now() NOT NULL,
	"github_delivery_id" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"installation_id" text NOT NULL UNIQUE,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"user_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"locked_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"installation_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"repository_hash" text NOT NULL,
	"html_url" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settlement" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"bounty_id" uuid NOT NULL,
	"recipient" text NOT NULL,
	"amount" bigint NOT NULL,
	"transaction_hash" text NOT NULL UNIQUE,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_link" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"wallet_address" text NOT NULL UNIQUE,
	"chain_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_link_challenge" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" text NOT NULL,
	"nonce" text NOT NULL UNIQUE,
	"message" text NOT NULL,
	"chain_id" integer NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"delivery_id" text NOT NULL UNIQUE,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" ("user_id");--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "bounty_chain_id_idx" ON "bounty" ("onchain_bounty_id");--> statement-breakpoint
CREATE INDEX "bounty_creator_idx" ON "bounty" ("creator_wallet");--> statement-breakpoint
CREATE INDEX "bounty_status_idx" ON "bounty" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "claim_bounty_pr_idx" ON "claim" ("bounty_id","github_pr_number");--> statement-breakpoint
CREATE INDEX "job_ready_idx" ON "job" ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_installation_name_idx" ON "repository" ("installation_id","full_name");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_bounty_idx" ON "settlement" ("bounty_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_link_user_idx" ON "wallet_link" ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_challenge_user_idx" ON "wallet_link_challenge" ("user_id");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "claim" ADD CONSTRAINT "claim_bounty_id_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "bounty"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_installation_id_github_installation_id_fkey" FOREIGN KEY ("installation_id") REFERENCES "github_installation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "settlement" ADD CONSTRAINT "settlement_bounty_id_bounty_id_fkey" FOREIGN KEY ("bounty_id") REFERENCES "bounty"("id") ON DELETE CASCADE;
