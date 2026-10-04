# PasinPay testing

The test suite is split by responsibility so failures identify the broken boundary instead of hiding behind one browser flow.

## Fast local checks

From PowerShell at the repository root:

```powershell
bun install
powershell -ExecutionPolicy Bypass -File .\scripts\test-local.ps1
```

The wrapper runs type checks, all Bun unit suites, the production build, and the Foundry contract suite. To run only the fast application checks, use `bun run check-types`, `bun run test`, and `bun run build` separately.

`bun run test` runs the Bun unit suites in the API, server, chain, and web workspaces through Turborepo. The web suite covers progress derivation, creator action availability, claim-button visibility, competing-PR copy, and wallet/contract error messages. The API suite covers open, merged, verified, closed, and superseded pull-request states.

## Contract suite

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test-contracts.ps1
```

The script uses native `forge` when available. On Windows machines without Foundry it uses Docker Desktop and the pinned project source, so the same Solidity tests run locally and in CI. The contract suite covers:

- creation, funding, fee calculation, duplicate funding, and cancellation;
- creator and owner authorization boundaries;
- EIP-712 signature, recipient, expiry, nonce, and replay rejection;
- first-claim-wins behavior for competing claimants;
- approval, review-window enforcement, finalization, payout, and platform fee events;
- expiry refunds;
- disputes, full refunds, partial resolutions, and fee handling;
- attestor and fee configuration limits.

## CI pipeline

GitHub Actions runs the same workspace checks with PostgreSQL, then builds the application images. A separate Foundry job runs `forge build` and `forge test -vv` against the Solidity project.

## End-to-end smoke testing

The full GitHub, wallet, and production-chain flow is intentionally kept as a smoke test rather than a mandatory unit-test step. It has irreversible external side effects and depends on GitHub App credentials, a linked wallet, testnet gas, and wallet approval UI. Run it only against disposable Arbitrum Sepolia fixtures:

1. Create a new test issue and bounty.
2. Merge two PRs with the same bounty marker.
3. Verify only one canonical claim is attested.
4. Submit, approve, wait through review, and finalize.
5. Verify `BountyPaid`, `PlatformFeePaid`, the settlement receipt, and the superseded PR state.
6. Run cancellation, expiry refund, dispute/full refund, dispute/partial resolution, wrong-wallet, replay, and rejected-wallet flows using separate test bounties.

Never put a real production private key in local files or CI secrets. Use deterministic local accounts for automated tests and isolated testnet accounts for smoke tests.
