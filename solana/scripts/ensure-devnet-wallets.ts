import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@solana/web3.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyPaths = {
	authority: resolve(projectRoot, "keys/devnet-authority.json"),
	attestor: resolve(projectRoot, "keys/devnet-attestor.json"),
	treasury: resolve(projectRoot, "keys/devnet-treasury.json"),
};

async function ensureKeypair(path: string) {
	try {
		return Keypair.fromSecretKey(
			Uint8Array.from(JSON.parse(await readFile(path, "utf8")) as number[]),
		);
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

const [authority, attestor, treasury] = await Promise.all(
	Object.values(keyPaths).map(ensureKeypair),
);

console.log(
	`Devnet program authority/deployer: ${authority.publicKey.toBase58()}`,
);
console.log(`Devnet claim attestor: ${attestor.publicKey.toBase58()}`);
console.log(`Devnet fee treasury: ${treasury.publicKey.toBase58()}`);
console.log("Private keys are stored only in ignored solana/keys files.");
