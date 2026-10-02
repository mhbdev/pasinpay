# PasinPay architecture

## Runtime flow

1. A maintainer signs `createBounty`, approves USDG, and signs `fundBounty` from the web app.
2. GitHub sends a signed `pull_request` webhook when a PR closes.
3. The API validates the HMAC and delivery ID, then writes a durable worker job.
4. The worker verifies the installation-scoped PR, repository, merge state, issue marker, and contributor wallet.
5. The attestor signs the EIP-712 `Claim` payload. No backend process transfers funds.
6. The contributor submits the signature onchain. The creator approves, the review window closes, and anyone can finalize.
7. Chain events are indexed into Postgres for the dashboard and public receipt.

## Services

- `apps/web`: Next.js product UI and wallet interactions.
- `apps/server`: Hono/tRPC API, Better Auth, webhook ingestion, readiness checks.
- `apps/server/src/worker.ts`: durable GitHub evidence and attestation worker.
- `packages/chain`: chain configuration, ABI, EIP-712 types, token metadata validation.
- `packages/db`: auth and domain schema.
- `contracts`: Foundry escrow and deployment scripts.

## Production requirements

- Use a managed Postgres database and run migrations as a one-shot release step.
- Inject secrets at runtime; never bake GitHub keys, RPC credentials, or attestor keys into images.
- Put TLS and request-size/rate limits at the reverse proxy and expose only web/API ports.
- Transfer contract ownership to a Safe multisig and use an isolated attestor key with a rotation runbook.
- Do not deploy value-bearing mainnet funds until the contract has independent review.
