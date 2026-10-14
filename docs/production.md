# PasinPay production requirements

The application supports Arbitrum Sepolia, Arbitrum One, Arc Testnet, and Arc Mainnet. Each API/worker deployment and corresponding web build targets one configured chain (`PASINPAY_CHAIN_ID` / `NEXT_PUBLIC_CHAIN_ID`). Arbitrum and Arc mainnets carry real value and require their configured tokens and gas.

## Arbitrum Sepolia deployment

The current x402-capable testnet escrow deployment was completed on 2026-10-10:

- Chain: Arbitrum Sepolia (`421614`)
- Escrow: `0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D`
- Deployment block: `317782125`
- Deployment transaction: `0x595376e31367fc1c85fa047eda4108330f0a6ed4035b825ee3b3a96c97db527d`
- USDG: `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` (`USDG`, 6 decimals)

## Arc deployments

Arc network configuration is built in:

| Network | Chain ID | RPC | Explorer | PasinPay token |
| --- | ---: | --- | --- | --- |
| Arc Testnet | `5042002` | `https://rpc.testnet.arc.io` | `https://explorer.testnet.arc.io` | USDC `0x3600000000000000000000000000000000000000` |
| Arc Mainnet | `5042` | `https://rpc.mainnet.arc.io` | `https://explorer.arc.io` | USDC `0x3600000000000000000000000000000000000000` |

Arc uses native USDC for gas with 18 native-token decimals. Its ERC-20 USDC interface uses 6 decimals. PasinPay reads ERC-20 decimals for bounty units, checks the configured token symbol, and uses the USDC EIP-712 domain (`USDC`, version `2`) for EIP-3009 x402 signatures. The wallet fee helper applies Arc's 20 gwei `maxFeePerGas` minimum.

Review [Arc's EVM differences](https://docs.arc.io/arc/references/evm-differences) before deploying or changing contracts. Arc has distinct native USDC transfer rules, blocklist enforcement, EIP-7708 transfer logs, and EVM opcode behavior; validate Arc-specific contract behavior with Arc Foundry (`arc-anvil --network arc`) rather than vanilla Anvil. The current escrow uses ERC-20 calls and does not rely on `SELFDESTRUCT`, but this review must be repeated for future contract changes. Circle USDC blocklisting can prevent a blocked creator or claimant from transferring funds.

PasinPay's Arc Testnet escrow was deployed and exercised on 2026-10-14:

- Chain: Arc Testnet (`5042002`)
- Escrow: `0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21`
- Deployment block: `67146353`
- Deployment transaction: `0xfd91c6da830e28649e16d9cc61e221729085d69adaf632cea0221ebd8c02cd04`
- Deployment receipt: [Arc Testnet Explorer](https://explorer.testnet.arc.io/tx/0xfd91c6da830e28649e16d9cc61e221729085d69adaf632cea0221ebd8c02cd04)
- USDC: `0x3600000000000000000000000000000000000000` (`USDC`, 6 ERC-20 decimals)
- Fee treasury: `0xBeB255445aCbF22d79C4b464A7A0e0B733969d2c` (250 bps)
- Onchain lifecycle test: create, ERC-20 fund, attested claim, approval, review window, payout, and platform fee all succeeded.
- x402 integration test: EIP-3009 authorization, PasinPay intent signature, escrow funding, and nonce consumption all succeeded.
- Explorer verification: [verified Arc Testnet contract](https://explorer.testnet.arc.io/address/0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21)
- Payout transaction: [bounty 1 settled](https://explorer.testnet.arc.io/tx/0xefbb160cb37aee83e4245b8d86afedc3a74a7adf9596035943c641716122dea2)
- x402 transaction: [bounty 2 funded](https://explorer.testnet.arc.io/tx/0xaf778e7597f136cbab609f8ae4b63ccb64d183438dd3261bc55ec137fea23b45)

The deployed testnet owner is an EOA and is suitable only for testnet. The deployed source is explorer-verified, but has not been independently audited for production. Do not use this testnet deployment as a substitute for the independent review and Safe ownership required before a mainnet deployment. To configure the Arc Testnet application, use:

- API/worker: `PASINPAY_CHAIN_ID=5042002`, `PASINPAY_ARC_TESTNET_ESCROW_ADDRESS=0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21`, `PASINPAY_ARC_TESTNET_TOKEN_ADDRESS=0x3600000000000000000000000000000000000000`, `PASINPAY_FEE_TREASURY_ADDRESS=0xBeB255445aCbF22d79C4b464A7A0e0B733969d2c`, and `PASINPAY_ESCROW_DEPLOYMENT_BLOCK=67146353`.
- Web build: `NEXT_PUBLIC_CHAIN_ID=5042002`, `NEXT_PUBLIC_ARC_TESTNET_ESCROW_ADDRESS=0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21`, `NEXT_PUBLIC_ARC_TESTNET_USDC_ADDRESS=0x3600000000000000000000000000000000000000`, and the same test fee treasury.
- Hosted x402 requires a funded, dedicated testnet relayer. Startup readiness checks the escrow adapter and the USDC EIP-3009 authorization interface.

To enable Arc Mainnet, follow the same steps with `PASINPAY_CHAIN_ID=5042`, `PASINPAY_ARC_MAINNET_ESCROW_ADDRESS`, `PASINPAY_ARC_MAINNET_TOKEN_ADDRESS`, `NEXT_PUBLIC_CHAIN_ID=5042`, `NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS`, and `NEXT_PUBLIC_ARC_MAINNET_USDC_ADDRESS`. Transfer escrow ownership to a Safe and complete the independent contract review and end-to-end acceptance checks before production use. x402 relaying remains testnet-only, matching the existing Arbitrum policy.

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
- RPC URLs for the selected chain (Arc official RPCs are configured by default and can be overridden with `PASINPAY_RPC_URL`)
- `PASINPAY_ATTESTOR_PRIVATE_KEY`: a dedicated server-side signer, never a deployer or user wallet
- `PASINPAY_X402_RELAYER_PRIVATE_KEY`: a dedicated testnet gas payer for hosted x402 settlement. Fund it with the active testnet's native gas token and monitor its balance; it cannot authorize or transfer a user's token.
- One verified escrow address per enabled chain:
  - `PASINPAY_SEPOLIA_ESCROW_ADDRESS=0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D`
  - `PASINPAY_MAINNET_ESCROW_ADDRESS`
- `PASINPAY_SEPOLIA_USDG_ADDRESS=0xFFC95faa3d63Cde504a05B567C600B78C0b41892`
- `PASINPAY_ARC_TESTNET_ESCROW_ADDRESS` / `PASINPAY_ARC_MAINNET_ESCROW_ADDRESS` and matching `NEXT_PUBLIC_*` web settings when Arc escrow deployments exist
- Set `PASINPAY_CHAIN_ID=421614` and `PASINPAY_ESCROW_DEPLOYMENT_BLOCK=317782125` for the current hosted testnet deployment. The recovery block must match the deployment block of the escrow configured for the active chain.
- Configure the web build with `NEXT_PUBLIC_CHAIN_ID=421614`, `NEXT_PUBLIC_SEPOLIA_ESCROW_ADDRESS`, and `NEXT_PUBLIC_SEPOLIA_USDG_ADDRESS` matching the API. Keep the mainnet escrow unset/zero; Arbitrum One is disabled in the UI and x402 API until reviewed and deployed.
- Matching token addresses and expected symbols are verified onchain at startup. x402 readiness probes the escrow's x402 nonce interface and the token's EIP-3009 authorization-state interface before enabling testnet funding.
- A Safe/multisig owner address for each deployed escrow; transfer contract ownership after deployment

### Contract deployment inputs

The Foundry deployment script also requires these values at deployment time:

- `PASINPAY_USDG_ADDRESS` (legacy Arbitrum) or `PASINPAY_TOKEN_ADDRESS`: the official ERC-20 token address for the target network
- `PASINPAY_ATTESTOR_ADDRESS`: the address corresponding to the protected attestor key
- `PASINPAY_OWNER_ADDRESS`: the initial Safe/multisig owner address
- A deployer private key supplied to Foundry through its signing mechanism; keep it separate from the attestor key and never place it in the application environment

After deployment, record the contract address in the matching `PASINPAY_*_ESCROW_ADDRESS` and `NEXT_PUBLIC_*_ESCROW_ADDRESS` settings, then verify the source on the network's explorer.

The Etherscan/Arbiscan API key is only needed for explorer verification and operational inspection. Keep it in Dokploy secrets and never expose it to the frontend.

## Deployment order

1. Create or verify the GitHub OAuth App and GitHub App.
2. Create managed Postgres and configure DNS/TLS for `pasinpay.upstand.dev` and `pasinpay-api.upstand.dev`.
3. Use the existing Arbitrum Sepolia deployment or deploy the escrow with the network's official token. For Arc Testnet, use the deployment above. Record transaction and address, and verify contract source where supported.
4. Configure Dokploy web, API, worker, and migration services with the same database, chain, auth, GitHub, and attestor settings.
5. Run the migration service once, then verify `/api/health` and `/api/readiness`.
6. Install the GitHub App on a test repository and confirm webhook delivery.
7. Execute the complete acceptance path on each enabled testnet: create bounty, approve the network token, fund, merge a mapped PR titled `[PasinPay #17] ...`, verify the webhook, generate the attestation, submit the claim, approve it, wait for the review window, finalize, and inspect the chain explorer receipt. Arc Testnet escrow calls and x402 settlement have been exercised directly onchain.
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
- [ ] Hosted testnet x402 readiness reports `configuration.x402Testnet: true`; API/web chain IDs, escrow and token addresses, and recovery block match the current deployment
- [ ] A signed x402 acceptance payment funds one test bounty; a replay returns the same receipt without funding twice; delayed settlement recovery reconciles after the authorization expires
- [ ] Worker reconciliation has a durable cursor and starts from the deployed chain block
- [ ] Attestor key is separate from deployer and owner keys
- [ ] Owner is transferred to a Safe/multisig
- [ ] Contract source is verified on the matching network explorer for every enabled chain
- [ ] Logs, backups, alerts, and rollback procedures are configured
- [ ] Mainnet use is gated behind an independent smart-contract review/audit
