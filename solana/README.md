# Solana Devnet

Solana support is Devnet-only. Mainnet stays disabled until the program and its
authority model receive a separate review.

## Local contract tests

Requirements: Bun, Docker Desktop with Linux containers enabled, and network
access to pull the pinned Anchor builder image.

```powershell
bun install
bun run --filter @pasinpay/solana-contract-tests test:e2e
```

The command builds the Anchor program in the pinned Anchor 1.2.1 container,
starts an isolated local validator, runs the escrow integration suite, and stops
the validator. It uses a local test mint, not faucet USDC. Generated local keys
and build output stay under ignored `solana/keys` and `solana/target`.

## Devnet deploy

Create dedicated, disposable Devnet identities and inspect their public
addresses:

```powershell
bun run --filter @pasinpay/solana wallets:devnet
```

Fund the program upgrade/config authority with Devnet SOL, then deploy and
initialize the program:

```powershell
bun run --filter @pasinpay/solana fund:devnet
bun run --filter @pasinpay/solana deploy:devnet
```

`deploy:devnet` validates the official six-decimal Circle USDC mint, builds and
deploys the program, initializes its config PDA once, and verifies the on-chain
authority, attestor, treasury, fee, mint, and network domain. It refuses to
silently change an existing config. If the program key is absent and the
configured address is not deployed, it generates a new Devnet program key and
synchronizes the Rust/Anchor IDs; this source change must be reviewed and
preserved along with the generated ignored key before future upgrades.

The deploy step saves runtime settings to the ignored,
secret-bearing `solana/keys/devnet.env`. Never commit or paste that file into a
chat. Configure the server with its `PASINPAY_SOLANA_DEVNET_*` values (especially
the attestor private key as a secret), and the web build with
`NEXT_PUBLIC_SOLANA_DEVNET_PROGRAM_ID` and
`NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL`. The deployment authority key controls
program upgrades and dispute resolution; back it up securely. Do not use these
Devnet keys on mainnet.

After requesting Circle faucet USDC to the Devnet authority wallet, run
`bun run --filter @pasinpay/solana-contract-tests smoke:devnet` for a real-chain
create → fund → attested claim → creator approval → review delay → payout flow.
It checks each on-chain state transition and exact USDC reward/fee balance
deltas. The isolated local-validator suite also tests authorization failures,
disputes, partial settlement, refunds, expiry, and cancellation.

For application funding tests, request SOL from the
[Solana Devnet Faucet](https://faucet.solana.com/) and Circle test USDC from the
[Circle Testnet Faucet](https://faucet.circle.com/?chain=SOL), selecting Solana
Devnet. Circle's faucet funds a wallet address; it does not fund program
deployment. A creator wallet and claimant wallet still need to be connected and
linked to their respective PasinPay/GitHub accounts to test the application
workflow.
