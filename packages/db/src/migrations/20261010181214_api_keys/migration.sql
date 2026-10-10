CREATE TABLE "api_key_credential" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL UNIQUE,
	"scopes" text[] DEFAULT '{bounties:read}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"expires_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE INDEX "api_key_credential_user_idx" ON "api_key_credential" ("user_id");--> statement-breakpoint
CREATE INDEX "api_key_credential_active_idx" ON "api_key_credential" ("key_hash","revoked_at");--> statement-breakpoint
ALTER TABLE "api_key_credential" ADD CONSTRAINT "api_key_credential_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;