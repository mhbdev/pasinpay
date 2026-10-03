import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "../apps/server/node_modules/viem/accounts";

const makeWallet = () => {
	const privateKey = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
	const account = privateKeyToAccount(privateKey);
	return { privateKey, address: account.address };
};

const deployer = makeWallet();
const attestor = makeWallet();
const owner = makeWallet();

const env = `# Disposable Arbitrum Sepolia testnet credentials. Never commit this file.
PASINPAY_CHAIN_ID=421614
PASINPAY_RPC_URL=https://sepolia-rollup.arbitrum.io/rpc
PASINPAY_USDG_ADDRESS=0xFFC95faa3d63Cde504a05B567C600B78C0b41892
PASINPAY_ATTESTOR_ADDRESS=${attestor.address}
PASINPAY_OWNER_ADDRESS=${owner.address}
PASINPAY_DEPLOYER_ADDRESS=${deployer.address}
PASINPAY_DEPLOYER_PRIVATE_KEY=${deployer.privateKey}
PASINPAY_ATTESTOR_PRIVATE_KEY=${attestor.privateKey}
PASINPAY_OWNER_PRIVATE_KEY=${owner.privateKey}
PASINPAY_SEPOLIA_ESCROW_ADDRESS=0x0000000000000000000000000000000000000000
`;

await Bun.write("contracts/.env.testnet.local", env);
console.log("Wrote contracts/.env.testnet.local");
console.log(`Deployer address: ${deployer.address}`);
console.log(`Attestor address: ${attestor.address}`);
console.log(`Owner address: ${owner.address}`);
