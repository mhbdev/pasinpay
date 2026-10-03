# PasinPay contracts

Install dependencies before compiling:

```bash
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge test
```

Deploy with `script/Deploy.s.sol`, passing the configured USDG, attestor, owner, and Safe treasury addresses through environment variables. The deployment defaults to a 250 bps (2.5%) platform fee and the contract hard-caps owner-configured fees at 500 bps (5%). Fees are held in escrow and paid to the treasury only when a claimant receives a reward; cancellation, expiry, and full dispute refunds return the entire creator outlay, including the fee.

Transfer ownership to a Safe before using a deployment with value-bearing assets. The Safe should control attestor rotation, fee configuration, treasury rotation, dispute resolution, and deployment administration. This contract is non-upgradeable; review and audit a new deployment before mainnet use.
