import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rpcUrl =
	process.env.PASINPAY_SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const keyPath = resolve(projectRoot, "keys/devnet-authority.json");
const authority = Keypair.fromSecretKey(
	Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8")) as number[]),
);
const connection = new Connection(rpcUrl, "confirmed");
const balance = await connection.getBalance(authority.publicKey, "confirmed");

if (balance >= 4 * LAMPORTS_PER_SOL) {
	console.log(
		`Authority already has ${(balance / LAMPORTS_PER_SOL).toFixed(4)} Devnet SOL; no faucet request sent.`,
	);
	process.exit(0);
}

let signature: string;
try {
	signature = await connection.requestAirdrop(
		authority.publicKey,
		2 * LAMPORTS_PER_SOL,
	);
} catch (cause) {
	throw new Error(
		`The Devnet RPC faucet did not accept the request. Use https://faucet.solana.com/ for ${authority.publicKey.toBase58()} and rerun; faucet rate limits can apply.`,
		{ cause },
	);
}
const confirmation = await connection.confirmTransaction(
	signature,
	"confirmed",
);
if (confirmation.value.err)
	throw new Error(`Devnet SOL faucet transaction failed: ${signature}`);

const fundedBalance = await connection.getBalance(
	authority.publicKey,
	"confirmed",
);
console.log(`Devnet authority: ${authority.publicKey.toBase58()}`);
console.log(`Airdrop transaction: ${signature}`);
console.log(
	`Confirmed balance: ${(fundedBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`,
);
