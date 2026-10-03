import { randomBytes } from "node:crypto";
import { privateKeyToAccount } from "../apps/server/node_modules/viem/accounts";

const privateKey = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
const account = privateKeyToAccount(privateKey);

await Bun.write(
	"contracts/.env.faucet.local",
	`# Disposable Arbitrum Sepolia faucet wallet. Never commit this file.\nPASINPAY_FAUCET_ADDRESS=${account.address}\nPASINPAY_FAUCET_PRIVATE_KEY=${privateKey}\n`,
);

console.log(`Faucet wallet address: ${account.address}`);
