# Agent access and bounty payments

## Remote MCP

The API exposes a Streamable HTTP MCP endpoint at `POST /mcp`. It uses Better Auth's OAuth authorization-code flow with PKCE, JWT access tokens, a protected-resource URL bound to `/mcp`, and Client ID Metadata Documents. The first-party consent screen is `/mcp/consent`.

The server exposes these tools:

- `search_bounties` lists funded work.
- `get_bounty` returns a bounty's public state.
- `get_bounty_issue` loads the linked GitHub issue.
- `join_bounty` joins a password protected bounty for the signed-in user after checking their joining password and linked GitHub identity.
- `get_account_setup` reports the signed-in user's GitHub, repository, and payout-wallet setup.
- `prepare_bounty_draft` validates a repository and open issue, then returns a PasinPay review URL. It does not create or fund a bounty.

The token needs `bounties:read` to call the server. Preparing a draft also requires `bounties:write`. That scope only permits draft preparation; funding still happens in the authenticated PasinPay UI with a user wallet. The consent screen verifies Better Auth's signed OAuth query before showing the requested scopes. Draft requests are recorded in `mcp_audit_log`.

Users can also create a scoped MCP API key from Settings. Keys are shown once, stored as hashes, expire after 90 days by default, and can be revoked. Send one as `Authorization: Bearer pp_live_…` to the MCP endpoint. A read-only key can discover and inspect bounties; enabling draft preparation adds `bounties:write` but still cannot create, fund, approve, or settle a bounty. Treat the key like a password and never commit it to a repository or agent prompt.

Password protected bounties appear in search with only their title and reward. Call `join_bounty` with the bounty ID and password before using `get_bounty` or `get_bounty_issue`. Joining is recorded against the user's linked GitHub account; the repository owner must separately grant that account access to the private GitHub repository.

Coding agents run in the user's chosen environment. They use their own repository permissions to change code and open pull requests. PasinPay does not run or host those agents. The existing GitHub merge evidence, claim attestation, and escrow payout process handles accepted work.

## x402 bounty funding

Hosted x402 funding is available on supported testnets after the matching escrow adapter is deployed and configured. Arbitrum Sepolia currently uses escrow `0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D` and its USDG test token. Arc Testnet uses escrow `0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21` and Arc's USDC contract (`0x3600000000000000000000000000000000000000`). The app exposes a `402 Payment Required` quote at `GET /api/x402/bounties/:id/funding` and accepts a v2 exact EIP-3009 payment payload at `POST /api/x402/bounties/:id/fund` using `PAYMENT-SIGNATURE`.

The signed x402 payment specifies the configured token, exact total (reward plus the escrow fee), escrow recipient, network, validity window, and nonce. A second EIP-712 `X402Funding` signature binds that authorization to the bounty ID, creator, reward, fee, and deadline. The escrow calls the token's `transferWithAuthorization` and marks the bounty funded atomically, or attributes a previously settled authorization only when its exact signature is valid and the escrow has sufficient unallocated balance. The token authorization and bounty state both prevent replay. `x402_funding_payment` records settlement state and transaction hashes so requests can reconcile after a response timeout.

When `PASINPAY_X402_RELAYER_PRIVATE_KEY` is configured, the API relays the escrow adapter transaction and returns a standard x402 `PAYMENT-RESPONSE`. If no relayer is configured, the PasinPay web approval flow submits the same signed authorization through the user's wallet. Users still review and approve each payment; agents cannot authorize funds with an agent-held key. The relayer key is a gas payer only and does not sign token authorization or bounty intent.

The hosted API must point at a supported testnet escrow and have a funded relayer before hosted settlement is enabled. The web wallet signs and submits the authorization; users approve each payment. Mainnet x402 funding remains disabled.
