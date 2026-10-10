# PasinPay contracts

Install dependencies before compiling:

```bash
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge test
```

Deploy with `script/Deploy.s.sol`, passing the configured USDG, attestor, owner, and Safe treasury addresses through environment variables. The deployment defaults to a 250 bps (2.5%) platform fee and the contract hard-caps owner-configured fees at 500 bps (5%). Fees are held in escrow and paid to the treasury only when a claimant receives a reward; cancellation, expiry, and full dispute refunds return the entire creator outlay, including the fee.

Transfer ownership to a Safe before using a deployment with value-bearing assets. The Safe should control attestor rotation, fee configuration, treasury rotation, dispute resolution, and deployment administration. This contract is non-upgradeable; review and audit a new deployment before mainnet use.

## x402 bounty funding

The Arbitrum Sepolia escrow supports x402 exact USDG payments through `fundBountyWithX402`. The token's EIP-3009 authorization is paired with a PasinPay EIP-712 intent that binds it to a bounty, payer, reward, fee, and expiration. The adapter transfers funds and marks the bounty funded atomically. It can also attribute an exact authorization already settled to the escrow, provided the signature and unallocated balance both check out.

The current Arbitrum Sepolia deployment is `0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D`. Mainnet x402 funding is not enabled. Deploy and independently review a separate contract before any mainnet use.
