# PasinPay

PasinPay connects accepted GitHub work to on-chain bounty payments. A creator chooses an issue, funds an escrow, and PasinPay verifies a merged pull request before issuing a claim attestation. The contributor claims the reward onchain after the creator's review window.

The repository contains the web app, API and worker, database schema, agent-facing MCP API, and Solidity escrow. See [docs/architecture.md](docs/architecture.md) for how the services work together and [docs/production.md](docs/production.md) before deploying.

## Features

- Create, fund, review, and settle GitHub issue bounties.
- Link a GitHub identity and payout wallet to a PasinPay account.
- Optionally protect a bounty with a joining password. Protected bounty listings show only the title and reward; users must authenticate and join to read details or participate. Password enrollment does not grant access to the private GitHub repository; its owner must grant repository access separately.
- Verify merged pull request evidence through a GitHub App and issue EIP-712 claim attestations.
- Offer bounties and payouts through an ERC-20 escrow contract.
- Expose bounty discovery and password joining to authenticated agents through the Streamable HTTP MCP endpoint.
- Support optional testnet x402 bounty funding with EIP-3009 token authorizations.

Public blockchain state is inspectable by anyone. Password protection gates PasinPay's bounty details and participation APIs; it does not make onchain transactions or data private.

## Supported networks

Each API/worker deployment and web build targets one network at a time. Set the same chain ID, token, and escrow configuration in the API and web build. Wallet settings include all supported chains, but transactions are enabled only for the chain configured in that build and only when its escrow address is nonzero.

| Network | Chain ID | Bounty token | Token decimals | Default explorer |
| --- | ---: | --- | ---: | --- |
| Arbitrum Sepolia | `421614` | USDG | 6 | [Arbiscan Sepolia](https://sepolia.arbiscan.io) |
| Arbitrum One | `42161` | USDG | 6 | [Arbiscan](https://arbiscan.io) |
| Arc Testnet | `5042002` | USDC | 6 | [Arc Testnet Explorer](https://explorer.testnet.arc.io) |
| Arc Mainnet | `5042` | USDC | 6 | [Arc Explorer](https://explorer.arc.io) |

Arc's native gas currency is USDC, represented with 18 decimals for gas accounting; the USDC ERC-20 interface used for bounty amounts has 6 decimals. PasinPay reads the ERC-20 token metadata at startup. Arc RPC defaults are `https://rpc.testnet.arc.io` and `https://rpc.mainnet.arc.io`; set `PASINPAY_RPC_URL` to use a provider endpoint of your choice. Arc USDC's configured contract is `0x3600000000000000000000000000000000000000` on both networks. Review [Arc's EVM differences](https://docs.arc.io/arc/references/evm-differences) before extending or deploying contracts there. The fee helper observes Arc's minimum 20 Gwei max fee requirement. Arc-specific execution should be tested with [Arc Foundry](https://docs.arc.io/arc/references/evm-differences#execution-and-opcode-differences) (`arc-anvil --network arc`) rather than vanilla Anvil, which does not reproduce Arc's EVM behavior.

Arc Testnet is deployed and supports the same escrow creation, funding, attested claim, approval, payout, and x402 EIP-3009 flows as Arbitrum Sepolia. Its escrow is `0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21`; the deployment and onchain acceptance transactions are recorded in [docs/production.md](docs/production.md). Arc Mainnet remains disabled until a separate escrow deployment and production review. Hosted x402 settlement is testnet-only.

## Local development

### Requirements

- [Bun](https://bun.sh) `1.4.2` (the version declared in `package.json`).
- Docker Compose for the local PostgreSQL database, or a compatible PostgreSQL instance.
- GitHub OAuth and GitHub App credentials to exercise login, repository synchronization, and webhook flows.
- Foundry (`forge`) for Arbitrum contract work, and Arc Foundry (`arc-forge`) for Arc runtime testing and deployment.

### Start the application

```bash
bun install
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
bun run env:generate
bun run db:start
bun run db:migrate
bun run dev
```

On Windows PowerShell, replace the two `cp` commands with `Copy-Item <source> <destination>`. Edit the app `.env` files with local values before starting the services. The server example points to local PostgreSQL and Arbitrum Sepolia; the web example uses the same default chain. Do not commit `.env` files or real credentials.

The web app is at [http://localhost:3001](http://localhost:3001) and the API is at [http://localhost:3000](http://localhost:3000). The database is PostgreSQL on port `5432`. The local GitHub callback and GitHub App webhook URLs must be configured in GitHub if you want to exercise those flows end to end. Environment variable schemas live beside each app's example in `.env.schema`; after changing a schema, regenerate the environment accessors with `bun run env:generate`.

The default example targets Arbitrum Sepolia. Arc Testnet's escrow and fee treasury are included in the chain defaults and can be selected by setting `PASINPAY_CHAIN_ID=5042002` / `NEXT_PUBLIC_CHAIN_ID=5042002`. Configure `PASINPAY_ESCROW_DEPLOYMENT_BLOCK=67146353` for Arc so event recovery starts at the deployed contract. Arc Mainnet escrow remains zero until a separately reviewed deployment exists. See the production guide for chain settings and deployment steps.

### Environment configuration

The server schema is [apps/server/.env.schema](apps/server/.env.schema), and the web schema is [apps/web/.env.schema](apps/web/.env.schema). Local environment files are loaded through Varlock; Bun's automatic `.env` loading is disabled. The web `NEXT_PUBLIC_*` settings are compiled into the web build and must be set at build time.

Important configuration groups:

- Database and authentication: `DATABASE_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `CORS_ORIGIN`.
- GitHub OAuth and App: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, and `GITHUB_WEBHOOK_SECRET`.
- Active chain: `PASINPAY_CHAIN_ID`, `PASINPAY_RPC_URL`, the matching `PASINPAY_*_ESCROW_ADDRESS` and token address, `PASINPAY_ESCROW_DEPLOYMENT_BLOCK`, and matching web `NEXT_PUBLIC_*` settings.
- Signing and settlement: `PASINPAY_ATTESTOR_PRIVATE_KEY`, `PASINPAY_X402_RELAYER_PRIVATE_KEY` (testnets only), and the configured fee treasury.

Use unique production secrets from a secret manager. Never put attestor, relayer, deployer, GitHub App, or auth secrets in frontend variables or source control. The x402 relayer pays gas only; it cannot authorize a user's bounty funding.

## Repository layout

```text
apps/
  web/       Next.js app, wallet flows, and user interface
  server/    Hono/tRPC API, Better Auth, GitHub webhook, MCP endpoint, and worker
  fumadocs/  project documentation site
packages/
  api/       Bounty and account API procedures
  auth/      Better Auth configuration
  chain/     Chain configs, escrow ABI, and token validation
  db/        Drizzle schema and PostgreSQL migrations
  ui/        Shared UI components and styles
contracts/
  src/       Solidity escrow contract
  script/    Foundry deployment scripts
  test/      Solidity escrow tests
docs/        Architecture, production, and agent integration guides
```

## Development checks

Run from the repository root:

```bash
bun run check-types
bun run test
bun run build
bun run smoke:arc
```

`bun run test` runs the workspace unit tests. `bun run smoke:arc` performs read-only live integration checks against all four configured chain RPCs and token interfaces, validates Arc EIP-3009 domains, and checks the deployed Arbitrum Sepolia x402 adapter; it requires network access. To run a package suite directly, use `bun run --filter <package-name> test` (for example, `bun run --filter web test`). For a non-mutating Biome check, pass the changed source paths to `bunx biome check <paths>`. `bun run check` applies fixes because its script includes `--write`; review its output diff.

For the Solidity suite (use Arc Foundry for Arc runtime behavior):

```bash
cd contracts
forge test
arc-forge test --network arc
```

Contract deployment is documented in [contracts/README.md](contracts/README.md). The deployment script accepts `PASINPAY_TOKEN_ADDRESS`; `PASINPAY_USDG_ADDRESS` remains as a legacy alias for Arbitrum deployments. Do not deploy to a value-bearing network until the contract has an independent review, the owner is a Safe, and the production checklist is complete.

## API and agent integration

The Hono server exposes the tRPC API, GitHub webhook, readiness endpoints, and an authenticated Streamable HTTP MCP endpoint at `/mcp`. MCP tools support bounty discovery, bounty detail and issue reads, password joining, account setup checks, and preparing a draft for review in the web app. Draft preparation does not create or fund a bounty.

Read [docs/agentic-bounty-mcp.md](docs/agentic-bounty-mcp.md) for OAuth scopes, API key use, tool behavior, and x402 payment details. Read [docs/architecture.md](docs/architecture.md) for webhook verification, worker, and attestation flow.

## Database and migrations

PostgreSQL schema and migrations are in `packages/db`. Apply checked-in migrations with:

```bash
bun run db:migrate
```

Generate a migration after schema changes with `bun run db:generate`; review and commit the generated SQL. `bun run db:push` is available for local schema iteration, but production deployments should use reviewed migrations as a release step. `bun run db:studio` opens Drizzle Studio.

## Production deployment

See [docs/production.md](docs/production.md) for required GitHub configuration, network/token addresses, secret settings, deployment order, x402 behavior, and go-live checks. The Docker Compose helpers are `bun run docker:build`, `bun run docker:up`, `bun run docker:logs`, and `bun run docker:down`.

Mainnet use involves real assets and requires a reviewed escrow deployment, verified source, secure signer and owner key handling, backups, monitoring, and an independent smart-contract audit. Configuration support is not equivalent to a deployed or audited production integration.

## Testnet addresses

The following addresses are used by the documented project testnet deployments. Links open the corresponding network explorer. Wallet roles are included where they were recorded in the deployment notes; role addresses are public identifiers, never private keys.

### Wallets and fee recipient

| Network | Role | Address | Explorer |
| --- | --- | --- | --- |
| Arbitrum Sepolia | Test deployer / funded test wallet | `0xd3D7687D3c5d6E3e14062Fb4206c774B59360b50` | [View address](https://sepolia.arbiscan.io/address/0xd3D7687D3c5d6E3e14062Fb4206c774B59360b50) |
| Arbitrum Sepolia | Escrow fee treasury (250 bps) | `0xBeB255445aCbF22d79C4b464A7A0e0B733969d2c` | [View address](https://sepolia.arbiscan.io/address/0xBeB255445aCbF22d79C4b464A7A0e0B733969d2c) |
| Arc Testnet | Test deployer / funded test wallet | `0xd3D7687D3c5d6E3e14062Fb4206c774B59360b50` | [View address](https://explorer.testnet.arc.io/address/0xd3D7687D3c5d6E3e14062Fb4206c774B59360b50) |
| Arc Testnet | Escrow fee treasury (250 bps) | `0xBeB255445aCbF22d79C4b464A7A0e0B733969d2c` | [View address](https://explorer.testnet.arc.io/address/0xBeB255445aCbF22d79C4b464A7A0e0B733969d2c) |

### Deployed contracts and tokens

| Network | Contract | Address | Explorer |
| --- | --- | --- | --- |
| Arc Testnet | PasinPay escrow (x402 capable) | `0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21` | [View verified contract](https://explorer.testnet.arc.io/address/0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21) |
| Arc Testnet | USDC (native Arc test token interface) | `0x3600000000000000000000000000000000000000` | [View token](https://explorer.testnet.arc.io/address/0x3600000000000000000000000000000000000000) |
| Arbitrum Sepolia | PasinPay escrow (x402 capable) | `0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D` | [View contract](https://sepolia.arbiscan.io/address/0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D) |
| Arbitrum Sepolia | USDG test token | `0xFFC95faa3d63Cde504a05B567C600B78C0b41892` | [View token](https://sepolia.arbiscan.io/address/0xFFC95faa3d63Cde504a05B567C600B78C0b41892) |

The Arc Testnet deployment's owner, attestor, and x402 relayer are also project wallets, but their addresses are not published in the deployment records. Their private keys must remain in local secret storage and must never be committed. A previous Arbitrum Sepolia escrow at `0x19B6944FB4748831D1B8462dDbD53F32655E1AF7` predates the x402 adapter and is not the active deployment; [view it on Arbiscan Sepolia](https://sepolia.arbiscan.io/address/0x19B6944FB4748831D1B8462dDbD53F32655E1AF7).
