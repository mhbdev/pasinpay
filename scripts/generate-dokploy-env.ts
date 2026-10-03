import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "../apps/server/node_modules/viem/accounts";

const outputPath = "apps/server/.env.dokploy.local";
const attestorKey = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
const attestor = privateKeyToAccount(attestorKey);

const env = `# Generated locally. Do not commit or paste into source control.
# Fill the external integration values before deploying.
BETTER_AUTH_SECRET=${randomBytes(32).toString("base64url")}
BETTER_AUTH_URL=https://pasinpay-api.upstand.dev
CORS_ORIGIN=https://pasinpay.upstand.dev
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=${randomBytes(32).toString("base64url")}
PASINPAY_CHAIN_ID=421614
PASINPAY_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
PASINPAY_USDG_ADDRESS=0xFFC95faa3d63Cde504a05B567C600B78C0b41892
PASINPAY_SEPOLIA_USDG_ADDRESS=0xFFC95faa3d63Cde504a05B567C600B78C0b41892
PASINPAY_MAINNET_USDG_ADDRESS=0x004B506865409877C9fA29bfb1ebA929984B9bbC
PASINPAY_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
PASINPAY_SEPOLIA_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
PASINPAY_MAINNET_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
PASINPAY_ATTESTOR_PRIVATE_KEY=${attestorKey}
PASINPAY_ATTESTOR_ADDRESS=${attestor.address}
DATABASE_URL=
`;

await Bun.write(outputPath, env);
console.log(`Wrote ${outputPath}`);
console.log(`Generated attestor address: ${attestor.address}`);
