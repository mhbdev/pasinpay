# PasinPay production requirements

This checklist separates the free Arbitrum Sepolia testnet path from the value-bearing Arbitrum One deployment. The application can run against both networks, but mainnet settlement is never free: it requires Arbitrum ETH for gas and real USDG.

## Arbitrum Sepolia deployment

The current x402-capable testnet escrow deployment was completed on 2026-10-10:

- Chain: Arbitrum Sepolia (`421614`)
- Escrow: `0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D`
- Deployment block: `317782125`
- Deployment transaction: `0x595376e31367fc1c85fa047eda4108330f0a6ed4035b825ee3b3a96c97db527d`
- USDG: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` (`USDG`, 6 decimals)

The previous Sepolia escrow deployment at `0x19B6944FB4748831D1B8462dDbD53F32655E1AF7` predates the x402 adapter and must not be configured for x402 funding. The current address is the adapter deployment. The owner is a testnet deployment account; transfer ownership to a Safe before any value-bearing mainnet deployment.

## Required application configuration

Inject these values through Dokploy secrets or an equivalent secret manager. Do not commit them to `.env` files.

### GitHub OAuth login

- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`
- OAuth callback URL: `https://pasinpay-api.upstand.dev/api/auth/callback/github`
- GitHub OAuth app homepage: `https://pasinpay.upstand.dev`
- GitHub OAuth app authorization callback must exactly match the callback URL above.

PasinPay uses GitHub OAuth for both account creation and login. Email/password and Resend email verification are intentionally disabled.

### GitHub App evidence access

- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_APP_PRIVATE_KEY` as the complete PEM value, with newlines preserved or escaped as required by Dokploy
- `GITHUB_WEBHOOK_SECRET`
- Install the App on every repository that should be available for bounty creation
- App permissions: repository metadata read, contents read, pull requests read, and webhook delivery access
- Webhook URL: `https://pasinpay-api.upstand.dev/api/github/webhook`
- Webhook events: `pull_request` and `installation`

Repository choices are read from the GitHub App installation. A client cannot register an arbitrary repository name.

### Runtime and chain secrets

- `BETTER_AUTH_SECRET`: a unique high-entropy secret of at least 32 characters
- `BETTER_AUTH_URL=https://pasinpay-api.upstand.dev`
- `CORS_ORIGIN=https://pasinpay.upstand.dev`
- Managed TLS Postgres `DATABASE_URL`, with backups and connection limits
- RPC URLs for Arbitrum Sepolia and Arbitrum One
- `PASINPAY_ATTESTOR_PRIVATE_KEY`: a dedicated server-side signer, never a deployer or user wallet
- `PASINPAY_X402_RELAYER_PRIVATE_KEY`: a dedicated Arbitrum Sepolia gas payer for hosted x402 settlement. Fund it with testnet ETH and monitor its balance; it cannot authorize or transfer a user's USDG.
- One verified escrow address per enabled chain:
  - `PASINPAY_SEPOLIA_ESCROW_ADDRESS=0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D`
  - `PASINPAY_MAINNET_ESCROW_ADDRESS`
- `PASINPAY_SEPOLIA_USDG_ADDRESS=0xFFC95faa3d63Cde504a05B567C600B78C0b41892`
- Set `PASINPAY_CHAIN_ID=421614` and `PASINPAY_ESCROW_DEPLOYMENT_BLOCK=317782125` for the current hosted testnet deployment. The recovery block must match the deployment block of the escrow configured for the active chain.
- Configure the web build with `NEXT_PUBLIC_CHAIN_ID=421614`, `NEXT_PUBLIC_SEPOLIA_ESCROW_ADDRESS`, and `NEXT_PUBLIC_SEPOLIA_USDG_ADDRESS` matching the API. Keep the mainnet escrow unset/zero; Arbitrum One is disabled in the UI and x402 API until reviewed and deployed.
- Matching USDG addresses are verified onchain at startup. x402 readiness probes the escrow's x402 nonce interface and USDG's EIP-3009 authorization-state interface before enabling Sepolia funding.
- A Safe/multisig owner address for each deployed escrow; transfer contract ownership after deployment

### Contract deployment inputs

The Foundry deployment script also requires these values at deployment time:

- `PASINPAY_USDG_ADDRESS`: the official token address for the target network
- `PASINPAY_ATTESTOR_ADDRESS`: the address corresponding to the protected attestor key
- `PASINPAY_OWNER_ADDRESS`: the initial Safe/multisig owner address
- A deployer private key supplied to Foundry through its signing mechanism; keep it separate from the attestor key and never place it in the application environment

After deployment, record the contract address in the matching `PASINPAY_*_ESCROW_ADDRESS` and `NEXT_PUBLIC_*_ESCROW_ADDRESS` settings, then verify the source on Arbiscan.

The Etherscan/Arbiscan API key is only needed for explorer verification and operational inspection. Keep it in Dokploy secrets and never expose it to the frontend.

## Deployment order

1. Create or verify the GitHub OAuth App and GitHub App.
2. Create managed Postgres and configure DNS/TLS for `pasinpay.upstand.dev` and `pasinpay-api.upstand.dev`.
3. Deploy the escrow contract to Arbitrum Sepolia with the official Sepolia USDG address. Record the deployment transaction, contract address, and verified source.
4. Configure Dokploy web, API, worker, and migration services with the same database, chain, auth, GitHub, and attestor settings.
5. Run the migration service once, then verify `/api/health` and `/api/readiness`.
6. Install the GitHub App on a test repository and confirm webhook delivery.
7. Execute the complete Sepolia acceptance path: create bounty, approve USDG, fund, merge a mapped PR titled `[PasinPay #17] ...`, verify the webhook, generate the attestation, submit the claim, approve it, wait for the review window, finalize, and inspect the Arbiscan receipt.
8. Only after Sepolia passes and the contract receives an independent review, deploy a separate Arbitrum One escrow and repeat the configuration and acceptance checks with real-value safeguards.

## Free testing boundary

Arbitrum Sepolia testing can be performed without spending real money by using faucet ETH and testnet USDG. Wallet signatures, RPC usage, GitHub, and local Docker development remain free within provider limits.

Arbitrum One is supported by configuration, but it requires real ETH for gas and real USDG for funding. It must not be advertised or treated as a free production test environment.

## Go-live checks

- [ ] OAuth callback works from the production domain and creates a Better Auth session
- [ ] GitHub App installation and repository synchronization work for an authorized repository
- [ ] Webhook HMAC validation rejects invalid signatures and duplicate deliveries
- [ ] Database migrations are applied before API/worker traffic
- [ ] Readiness reports database, RPC, GitHub configuration, and escrow configuration
- [ ] Hosted Sepolia x402 readiness reports `configuration.x402Sepolia: true`; API/web chain IDs, escrow and token addresses, and recovery block match the current deployment
- [ ] A signed x402 acceptance payment funds one test bounty; a replay returns the same receipt without funding twice; delayed settlement recovery reconciles after the authorization expires
- [ ] Worker reconciliation has a durable cursor and starts from the deployed chain block
- [ ] Attestor key is separate from deployer and owner keys
- [ ] Owner is transferred to a Safe/multisig
- [ ] Contract source is verified on Arbiscan for every enabled chain
- [ ] Logs, backups, alerts, and rollback procedures are configured
- [ ] Mainnet use is gated behind an independent smart-contract review/audit
