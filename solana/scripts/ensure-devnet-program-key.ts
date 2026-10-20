import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const keyPath = resolve(
	projectRoot,
	"target/deploy/pasinpay_escrow-keypair.json",
);
const programSourcePath = resolve(projectRoot, "programs/pasinpay/src/lib.rs");
const anchorConfigPath = resolve(projectRoot, "Anchor.toml");
const rpcUrl =
	process.env.PASINPAY_SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com";
const connection = new Connection(rpcUrl, "confirmed");

const [programSource, anchorConfig] = await Promise.all([
	readFile(programSourcePath, "utf8"),
	readFile(anchorConfigPath, "utf8"),
]);
const declaredProgramId = programSource.match(
	/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\);/,
)?.[1];
if (!declaredProgramId)
	throw new Error("Could not read declare_id! from the program source");

try {
	const keypair = Keypair.fromSecretKey(
		Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8")) as number[]),
	);
	if (keypair.publicKey.toBase58() !== declaredProgramId)
		throw new Error(
			"The saved Devnet program keypair does not match declare_id! in lib.rs",
		);
	const configuredIds = [
		...anchorConfig.matchAll(/pasinpay_escrow\s*=\s*"([^"]+)"/g),
	];
	if (
		configuredIds.length < 2 ||
		configuredIds.some((match) => match[1] !== declaredProgramId)
	)
		throw new Error(
			"Anchor.toml program IDs do not match the saved program keypair",
		);
	console.log(`Devnet program upgrade key is ready for ${declaredProgramId}.`);
	process.exit(0);
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const oldProgramAccount = await connection.getAccountInfo(
	new PublicKey(declaredProgramId),
	"confirmed",
);
if (oldProgramAccount)
	throw new Error(
		`The configured program ${declaredProgramId} already exists on Devnet but its upgrade key is missing. Restore the original key; refusing to replace the deployed identity.`,
	);

const keypair = Keypair.generate();
const newProgramId = keypair.publicKey.toBase58();
await mkdir(dirname(keyPath), { recursive: true });
await writeFile(keyPath, JSON.stringify(Array.from(keypair.secretKey)), {
	encoding: "utf8",
	mode: 0o600,
	flag: "wx",
});
const syncedProgramSource = programSource.replace(
	`declare_id!("${declaredProgramId}");`,
	`declare_id!("${newProgramId}");`,
);
const syncedAnchorConfig = anchorConfig.replaceAll(
	`"${declaredProgramId}"`,
	`"${newProgramId}"`,
);
if (
	syncedProgramSource === programSource ||
	syncedAnchorConfig === anchorConfig
)
	throw new Error(
		"Could not synchronize the newly generated Devnet program ID",
	);
await Promise.all([
	writeFile(programSourcePath, syncedProgramSource, "utf8"),
	writeFile(anchorConfigPath, syncedAnchorConfig, "utf8"),
]);
console.log(`Generated a new Devnet-only program ID: ${newProgramId}`);
console.log(
	"Updated declare_id! and Anchor.toml to match; the secret key is ignored.",
);
