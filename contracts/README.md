# PasinPay contracts

Install dependencies before compiling:

```bash
forge install OpenZeppelin/openzeppelin-contracts --no-commit
forge test
```

Deploy with `script/Deploy.s.sol`, passing the configured USDG and attestor addresses through environment variables. Transfer ownership to a Safe before using a deployment with value-bearing assets.
