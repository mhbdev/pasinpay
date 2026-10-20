import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createInitializeInstruction,
	fetchSolanaEscrowConfig,
	SOLANA_DEVNET_NETWORK_DOMAIN,
	SOLANA_DEVNET_RPC_URL,
	SOLANA_DEVNET_USDC_MINT,
} from "@pasinpay/solana";
import {
	AccountRole,
	createSolanaRpc,
	getBase58Decoder,
	type Instruction,
} from "@solana/kit";
import { getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
	Connection,
	Keypair,
	PublicKey,
	sendAndConfirmTransaction,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const repositoryRoot = resolve(projectRoot, "..");
const image =
	process.env.PASINPAY_ANCHOR_IMAGE ?? "quay.io/ottersec/anchor:v1.2.1";
const toolchainCacheVolume = "pasinpay-solana-toolchain-cache";
const rpcUrl =
	process.env.PASINPAY_SOLANA_DEVNET_RPC_URL ?? SOLANA_DEVNET_RPC_URL;
const authorityPath = resolve(projectRoot, "keys/devnet-authority.json");
const attestorPath = resolve(projectRoot, "keys/devnet-attestor.json");
const treasuryPath = resolve(projectRoot, "keys/devnet-treasury.json");
const programKeyPath = resolve(
	projectRoot,
	"target/deploy/pasinpay_escrow-keypair.json",
);
const programBinaryPath = resolve(
	projectRoot,
	"target/deploy/pasinpay_escrow.so",
);
const connection = new Connection(rpcUrl, "confirmed");
const rpc = createSolanaRpc(rpcUrl);
const feeBps = 250;

function run(command: string, args: string[], cwd?: string) {
	return new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			cwd,
			windowsHide: true,
			stdio: "inherit",
		});
		child.once("error", rejectPromise);
		child.once("exit", (code) => {
			if (code === 0) resolvePromise();
			else
				rejectPromise(
					new Error(`${command} exited with status ${code ?? "unknown"}`),
				);
		});
	});
}

async function loadKeypair(path: string) {
	return Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(await readFile(path, "utf8")) as number[]),
	);
}

function toWeb3Instruction(input: Instruction) {
	return new TransactionInstruction({
		programId: new PublicKey(input.programAddress),
		keys: (input.accounts ?? []).map((meta) => {
			if (!("role" in meta))
				throw new Error(
					"Deployment instruction unexpectedly requires a lookup table",
				);
			return {
				pubkey: new PublicKey(meta.address),
				isSigner:
					meta.role === AccountRole.READONLY_SIGNER ||
					meta.role === AccountRole.WRITABLE_SIGNER,
				isWritable:
					meta.role === AccountRole.WRITABLE ||
					meta.role === AccountRole.WRITABLE_SIGNER,
			};
		}),
		data: Buffer.from(input.data ?? new Uint8Array()),
	});
}

await run(
	process.execPath,
	["scripts/ensure-devnet-program-key.ts"],
	projectRoot,
);

const [authority, attestor, treasury, programKeypair] = await Promise.all([
	loadKeypair(authorityPath),
	loadKeypair(attestorPath),
	loadKeypair(treasuryPath),
	loadKeypair(programKeyPath),
]);
const programId = programKeypair.publicKey;

for (const configPath of [
	resolve(projectRoot, "Anchor.toml"),
	resolve(projectRoot, "programs/pasinpay/src/lib.rs"),
]) {
	const source = await readFile(configPath, "utf8");
	if (!source.includes(programId.toBase58()))
		throw new Error(
			`Program ID in ${configPath} does not match the deploy keypair`,
		);
}

const mint = await getMint(
	connection,
	new PublicKey(SOLANA_DEVNET_USDC_MINT),
	"confirmed",
	TOKEN_PROGRAM_ID,
);
if (mint.decimals !== 6)
	throw new Error(
		"The configured Circle Devnet USDC mint does not have six decimals",
	);

const existingConfig = await fetchSolanaEscrowConfig(rpc, programId.toBase58());
if (existingConfig) {
	const aligned =
		existingConfig.authority === authority.publicKey.toBase58() &&
		existingConfig.attestor === attestor.publicKey.toBase58() &&
		existingConfig.feeTreasury === treasury.publicKey.toBase58() &&
		existingConfig.mint === SOLANA_DEVNET_USDC_MINT &&
		existingConfig.feeBps === feeBps &&
		existingConfig.networkDomain.every(
			(value, index) => value === SOLANA_DEVNET_NETWORK_DOMAIN[index],
		);
	if (!aligned)
		throw new Error(
			"The existing on-chain config does not match these deployment keys/settings. Refusing to deploy or rotate it automatically.",
		);
}

const containerArgs = [
	"run",
	"--rm",
	"--volume",
	`${toolchainCacheVolume}:/root/.cache/solana`,
	"--volume",
	`${repositoryRoot}:/workspace`,
	"--workdir",
	"/workspace/solana",
	image,
];
await run("docker", [...containerArgs, "anchor", "build"]);

const programBytes = (await readFile(programBinaryPath)).byteLength;
const programDataRent = await connection.getMinimumBalanceForRentExemption(
	programBytes + 45,
);
const bufferRent = await connection.getMinimumBalanceForRentExemption(
	programBytes + 45,
);
const minimumDeploymentBalance = programDataRent + bufferRent + 100_000_000;
let balance = await connection.getBalance(authority.publicKey, "confirmed");
if (balance < minimumDeploymentBalance) {
	throw new Error(
		`Devnet deployer has ${(balance / 1e9).toFixed(3)} SOL but the measured deployment reserve is ${(minimumDeploymentBalance / 1e9).toFixed(3)} SOL. Fund ${authority.publicKey.toBase58()} from the official Solana Devnet faucet, then rerun.`,
	);
}

await run("docker", [
	...containerArgs,
	"anchor",
	"deploy",
	"--provider.cluster",
	rpcUrl,
	"--provider.wallet",
	"/workspace/solana/keys/devnet-authority.json",
]);

if (!existingConfig) {
	const initialize = await createInitializeInstruction({
		programId: programId.toBase58(),
		authority: authority.publicKey.toBase58(),
		attestor: attestor.publicKey.toBase58(),
		feeTreasury: treasury.publicKey.toBase58(),
		feeBps,
		networkDomain: SOLANA_DEVNET_NETWORK_DOMAIN,
		mint: SOLANA_DEVNET_USDC_MINT,
	});
	const transaction = new Transaction().add(toWeb3Instruction(initialize));
	transaction.feePayer = authority.publicKey;
	const signature = await sendAndConfirmTransaction(
		connection,
		transaction,
		[authority],
		{ commitment: "confirmed" },
	);
	console.log(`Escrow config initialized: ${signature}`);
}

const attestorBase58 = getBase58Decoder().decode(attestor.secretKey);
const privateEnvPath = resolve(projectRoot, "keys/devnet.env");
const generatedEnv = [
	`PASINPAY_SOLANA_DEVNET_RPC_URL=${rpcUrl}`,
	`PASINPAY_SOLANA_DEVNET_PROGRAM_ID=${programId.toBase58()}`,
	`PASINPAY_SOLANA_DEVNET_FEE_TREASURY=${treasury.publicKey.toBase58()}`,
	`PASINPAY_SOLANA_DEVNET_ATTESTOR_PRIVATE_KEY=${attestorBase58}`,
	`NEXT_PUBLIC_SOLANA_DEVNET_PROGRAM_ID=${programId.toBase58()}`,
	`NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL=${rpcUrl}`,
	`PASINPAY_SOLANA_DEVNET_AUTHORITY=${authority.publicKey.toBase58()}`,
	`PASINPAY_FEE_BPS=${feeBps}`,
	"",
].join("\n");
await mkdir(dirname(privateEnvPath), { recursive: true });
await writeFile(privateEnvPath, generatedEnv, {
	encoding: "utf8",
	mode: 0o600,
});

balance = await connection.getBalance(authority.publicKey, "confirmed");
console.log(`Solana Devnet program: ${programId.toBase58()}`);
console.log(`Upgrade/config authority: ${authority.publicKey.toBase58()}`);
console.log(`Claim attestor: ${attestor.publicKey.toBase58()}`);
console.log(`Fee treasury: ${treasury.publicKey.toBase58()}`);
console.log(`Official Devnet USDC mint verified: ${SOLANA_DEVNET_USDC_MINT}`);
console.log(`Remaining authority balance: ${(balance / 1e9).toFixed(4)} SOL`);
console.log(
	"On-chain initialization settings are verified against the Devnet account.",
);
console.log(
	"Secret-bearing environment file saved under ignored solana/keys/devnet.env.",
);
