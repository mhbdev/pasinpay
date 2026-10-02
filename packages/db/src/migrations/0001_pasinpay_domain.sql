CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS "user" (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, email_verified boolean NOT NULL DEFAULT false,
  image text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "session" (
  id text PRIMARY KEY, expires_at timestamptz NOT NULL, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), ip_address text, user_agent text, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS session_userId_idx ON "session"(user_id);

CREATE TABLE IF NOT EXISTS account (
  id text PRIMARY KEY, account_id text NOT NULL, provider_id text NOT NULL, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  access_token text, refresh_token text, id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
  scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_userId_idx ON account(user_id);

CREATE TABLE IF NOT EXISTS verification (
  id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_identifier_idx ON verification(identifier);

CREATE TABLE IF NOT EXISTS rate_limit (
  id text PRIMARY KEY, key text NOT NULL UNIQUE, count integer NOT NULL, last_request bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS wallet_link_challenge (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, nonce text NOT NULL UNIQUE,
  message text NOT NULL, chain_id integer NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_challenge_user_idx ON wallet_link_challenge(user_id);

CREATE TABLE IF NOT EXISTS wallet_link (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL UNIQUE, wallet_address text NOT NULL UNIQUE,
  chain_id integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS github_installation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), installation_id text NOT NULL UNIQUE, account_login text NOT NULL,
  account_type text NOT NULL, user_id text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repository (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), installation_id uuid NOT NULL REFERENCES github_installation(id) ON DELETE CASCADE,
  full_name text NOT NULL, repository_hash text NOT NULL, html_url text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT repository_installation_name_unique UNIQUE (installation_id, full_name)
);

CREATE TABLE IF NOT EXISTS bounty (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, onchain_bounty_id numeric(78,0) UNIQUE,
  creator_wallet text NOT NULL, repository text NOT NULL, repository_hash text NOT NULL, issue_number integer NOT NULL,
  title text NOT NULL, amount numeric(78,0) NOT NULL, deadline timestamptz NOT NULL, review_window_seconds integer NOT NULL,
  review_ends timestamptz, claimant_wallet text, claim_digest text, status text NOT NULL DEFAULT 'Open',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bounty_creator_idx ON bounty(creator_wallet);
CREATE INDEX IF NOT EXISTS bounty_status_idx ON bounty(status);

CREATE TABLE IF NOT EXISTS claim (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL REFERENCES bounty(id) ON DELETE CASCADE,
  github_pr_number integer NOT NULL, merge_commit_sha text NOT NULL, claimant_wallet text NOT NULL,
  attestation_digest text NOT NULL UNIQUE, attestation_signature text NOT NULL, attestation_nonce numeric(78,0) NOT NULL DEFAULT 0,
  attestation_expires_at timestamptz NOT NULL DEFAULT now(), github_delivery_id text NOT NULL, evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT claim_bounty_pr_unique UNIQUE (bounty_id, github_pr_number)
);

CREATE TABLE IF NOT EXISTS settlement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bounty_id uuid NOT NULL UNIQUE REFERENCES bounty(id) ON DELETE CASCADE,
  recipient text NOT NULL, amount numeric(78,0) NOT NULL, transaction_hash text NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), delivery_id text NOT NULL UNIQUE, event text NOT NULL, payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL, payload jsonb NOT NULL, status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz,
  last_error text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_ready_idx ON job(status, available_at);

CREATE TABLE IF NOT EXISTS chain_cursor (
  id text PRIMARY KEY, chain_id integer NOT NULL, last_block numeric(78,0) NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
