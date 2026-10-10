# Agent access and bounty payments

## Remote MCP

The API exposes a Streamable HTTP MCP endpoint at `POST /mcp`. It uses Better Auth's OAuth authorization-code flow with PKCE, JWT access tokens, a protected-resource URL bound to `/mcp`, and Client ID Metadata Documents. The first-party consent screen is `/mcp/consent`.

The server exposes these tools:

- `search_bounties` lists funded work.
- `get_bounty` returns a bounty's public state.
- `get_bounty_issue` loads the linked GitHub issue.
- `get_account_setup` reports the signed-in user's GitHub, repository, and payout-wallet setup.
- `prepare_bounty_draft` validates a repository and open issue, then returns a PasinPay review URL. It does not create or fund a bounty.

The token needs `bounties:read` to call the server. Preparing a draft also requires `bounties:write`. That scope only permits draft preparation; funding still happens in the authenticated PasinPay UI with a user wallet. The consent screen verifies Better Auth's signed OAuth query before showing the requested scopes. Draft requests are recorded in `mcp_audit_log`.

Coding agents run in the user's chosen environment. They use their own repository permissions to change code and open pull requests. PasinPay does not run or host those agents. The existing GitHub merge evidence, claim attestation, and escrow payout process handles accepted work.

## x402 bounty funding

The first x402 funding release targets Arbitrum Sepolia only. The escrow adapter is deployed at `0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D`; the USDG test token is the Paxos Arbitrum Sepolia deployment. The app exposes a `402 Payment Required` quote at `GET /api/x402/bounties/:id/funding` and accepts a v2 exact EIP-3009 payment payload at `POST /api/x402/bounties/:id/fund` using `PAYMENT-SIGNATURE`.

The signed x402 payment specifies the USDG token, exact total (reward plus the escrow fee), escrow recipient, network, validity window, and nonce. A second EIP-712 `X402Funding` signature binds that authorization to the bounty ID, creator, reward, fee, and deadline. The escrow calls USDG `transferWithAuthorization` and marks the bounty funded atomically, or attributes a previously settled authorization only when its exact signature is valid and the escrow has sufficient unallocated balance. The token authorization and bounty state both prevent replay. `x402_funding_payment` records settlement state and transaction hashes so requests can reconcile after a response timeout.

When `PASINPAY_X402_RELAYER_PRIVATE_KEY` is configured, the API relays the escrow adapter transaction and returns a standard x402 `PAYMENT-RESPONSE`. If no relayer is configured, the PasinPay web approval flow submits the same signed authorization through the user's wallet. Users still review and approve each payment; agents cannot authorize funds with an agent-held key. The relayer key is a gas payer only and does not sign the USDG authorization or bounty intent.

The hosted API must point at the Sepolia escrow and have a funded Sepolia relayer before hosted settlement is enabled. The web wallet fallback is limited to Arbitrum Sepolia. Arbitrum One mainnet x402 funding remains disabled until the facilitator path, token compatibility, and new escrow deployment receive independent review.
