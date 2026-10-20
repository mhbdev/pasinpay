import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function ensureKeypair(path: string) {
	try {
		const bytes = JSON.parse(await readFile(path, "utf8")) as number[];
		return Keypair.fromSecretKey(Uint8Array.from(bytes));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	await mkdir(dirname(path), { recursive: true });
	const keypair = Keypair.generate();
	await writeFile(path, JSON.stringify(Array.from(keypair.secretKey)), {
		encoding: "utf8",
		mode: 0o600,
		flag: "wx",
	});
	return keypair;
}

await ensureKeypair(resolve(projectRoot, "keys/localnet-authority.json"));
console.log("Local validator authority key is ready.");
