import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createAssociatedTokenAccountIdempotentInstruction,
	createBountyInstruction,
	createClaimInstruction,
	createCreatorActionInstruction,
	createEd25519VerificationInstruction,
	createFinalizeClaimInstruction,
	createFundBountyInstruction,
	decodeSolanaBountyAccount,
	deriveAssociatedTokenAddress,
	deriveBountyAddress,
	encodeSolanaClaimMessage,
	fetchSolanaEscrowConfig,
	SOLANA_DEVNET_NETWORK_DOMAIN,
	SOLANA_DEVNET_RPC_URL,
	SOLANA_DEVNET_USDC_MINT,
	signSolanaBytes,
} from "@pasinpay/solana";
import {
	AccountRole,
	createSolanaRpc,
	getBase58Decoder,
	type Instruction,
} from "@solana/kit";
import { getAccount, getMint, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	sendAndConfirmTransaction,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const rpcUrl =
	process.env.PASINPAY_SOLANA_DEVNET_RPC_URL ?? SOLANA_DEVNET_RPC_URL;
const connection = new Connection(rpcUrl, "confirmed");
const rpc = createSolanaRpc(rpcUrl);
const mint = new PublicKey(SOLANA_DEVNET_USDC_MINT);
const feeBps = 250;
const rewardAmount = BigInt(100_000);

async function loadKeypair(file: string) {
	return Keypair.fromSecretKey(
		Uint8Array.from(
			JSON.parse(
				await readFile(resolve(projectRoot, file), "utf8"),
			) as number[],
		),
	);
}

function toWeb3Instruction(input: Instruction) {
	return new TransactionInstruction({
		programId: new PublicKey(input.programAddress),
		keys: (input.accounts ?? []).map((meta) => {
			if (!("role" in meta))
				throw new Error("Smoke test does not support address lookup tables");
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

async function send(
	feePayer: Keypair,
	instructions: TransactionInstruction[],
	additionalSigners: Keypair[] = [],
) {
	const transaction = new Transaction().add(...instructions);
	transaction.feePayer = feePayer.publicKey;
	const signers = new Map(
		[feePayer, ...additionalSigners].map((signer) => [
			signer.publicKey.toBase58(),
			signer,
		]),
	);
	return sendAndConfirmTransaction(
		connection,
		transaction,
		[...signers.values()],
		{ commitment: "confirmed" },
	);
}

async function readBounty(programId: string, bountyId: bigint) {
	const bountyAddress = await deriveBountyAddress(programId, bountyId);
	const { value } = await rpc
		.getAccountInfo(bountyAddress, {
			commitment: "confirmed",
			encoding: "base64",
		})
		.send();
	if (!value || value.owner !== programId)
		throw new Error(
			"The expected bounty PDA is missing or has the wrong owner",
		);
	return decodeSolanaBountyAccount(
		new Uint8Array(Buffer.from(value.data[0], "base64")),
	);
}

async function waitForChainTime(target: bigint) {
	const timeout = Date.now() + 90_000;
	while (Date.now() < timeout) {
		const slot = await connection.getSlot("confirmed");
		const blockTime = await connection.getBlockTime(slot);
		if (blockTime !== null && BigInt(blockTime) >= target) return;
		await new Promise((done) => setTimeout(done, 750));
	}
	throw new Error(
		"Devnet did not advance through the configured review window",
	);
}

const [authority, attestor, treasury, programKeypair] = await Promise.all([
	loadKeypair("keys/devnet-authority.json"),
	loadKeypair("keys/devnet-attestor.json"),
	loadKeypair("keys/devnet-treasury.json"),
	loadKeypair("target/deploy/pasinpay_escrow-keypair.json"),
]);
const programId = programKeypair.publicKey.toBase58();
const [programAccount, escrowConfig, onchainMint] = await Promise.all([
	connection.getAccountInfo(programKeypair.publicKey, "confirmed"),
	fetchSolanaEscrowConfig(rpc, programId),
	getMint(connection, mint, "confirmed", TOKEN_PROGRAM_ID),
]);
if (!programAccount?.executable)
	throw new Error("The configured program is not deployed on Devnet");
if (onchainMint.decimals !== 6)
	throw new Error("The Circle Devnet USDC mint must use six decimal places");
if (!escrowConfig)
	throw new Error("The program config PDA is not initialized on Devnet");
if (
	escrowConfig.authority !== authority.publicKey.toBase58() ||
	escrowConfig.attestor !== attestor.publicKey.toBase58() ||
	escrowConfig.feeTreasury !== treasury.publicKey.toBase58() ||
	escrowConfig.mint !== SOLANA_DEVNET_USDC_MINT ||
	escrowConfig.feeBps !== feeBps ||
	escrowConfig.networkDomain.some(
		(value, index) => value !== SOLANA_DEVNET_NETWORK_DOMAIN[index],
	)
)
	throw new Error(
		"Local Devnet identities/settings do not match on-chain config",
	);

const authoritySol = await connection.getBalance(
	authority.publicKey,
	"confirmed",
);
if (authoritySol < 0.05 * LAMPORTS_PER_SOL)
	throw new Error(
		"The Devnet authority needs at least 0.05 SOL for this smoke test",
	);
const creatorAtaAddress = await deriveAssociatedTokenAddress(
	authority.publicKey.toBase58(),
	mint.toBase58(),
);
const creatorAtaInfo = await connection.getAccountInfo(
	new PublicKey(creatorAtaAddress),
	"confirmed",
);
const creatorAtaAmount = creatorAtaInfo
	? (
			await getAccount(
				connection,
				new PublicKey(creatorAtaAddress),
				"confirmed",
			)
		).amount
	: BigInt(0);
const feeAmount = (rewardAmount * BigInt(feeBps)) / BigInt(10_000);
const requiredUsdc = rewardAmount + feeAmount;
if (creatorAtaAmount < requiredUsdc)
	throw new Error(
		`The authority wallet needs ${(Number(requiredUsdc) / 1_000_000).toFixed(6)} USDC. Request Circle test USDC to ${authority.publicKey.toBase58()} and rerun.`,
	);

const created = await createBountyInstruction({
	programId,
	creator: authority.publicKey.toBase58(),
	config: escrowConfig,
	repositoryHash: new Uint8Array(randomBytes(32)),
	issueNumber: 1_000_000 + Math.floor(Math.random() * 1_000_000),
	deadline: BigInt(Math.floor(Date.now() / 1000) + 1_800),
	reviewWindow: BigInt(10),
});
const createSignature = await send(authority, [
	toWeb3Instruction(created.instruction),
]);
const fund = await createFundBountyInstruction({
	programId,
	creator: authority.publicKey.toBase58(),
	bountyId: created.bountyId,
	rewardAmount,
	mint: SOLANA_DEVNET_USDC_MINT,
});
const fundSignature = await send(authority, [
	toWeb3Instruction(fund.instruction),
]);
let state = await readBounty(programId, created.bountyId);
if (
	state.status !== "Funded" ||
	state.amount !== rewardAmount ||
	state.feeAmount !== feeAmount ||
	state.totalFunded !== requiredUsdc
)
	throw new Error(
		"Funded on-chain bounty values do not match the expected reward/fee",
	);

const claimant = Keypair.generate();
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 600);
const nonce = new Uint8Array(randomBytes(32));
const commitHash = new Uint8Array(randomBytes(32));
const claimMessage = encodeSolanaClaimMessage({
	programId,
	networkDomain: escrowConfig.networkDomain,
	bountyAddress: created.bountyAddress,
	bountyId: created.bountyId,
	repositoryHash: state.repositoryHash,
	issueNumber: state.issueNumber,
	prNumber: 1,
	commitHash,
	claimant: claimant.publicKey.toBase58(),
	expiresAt,
	nonce,
});
const signed = await signSolanaBytes(
	getBase58Decoder().decode(attestor.secretKey),
	claimMessage,
);
if (signed.signer !== escrowConfig.attestor)
	throw new Error(
		"Devnet attestor secret does not match the trusted on-chain signer",
	);
const ed25519 = createEd25519VerificationInstruction({
	attestor: signed.signer,
	signature: signed.signature,
	message: claimMessage,
});
const claim = await createClaimInstruction({
	programId,
	claimant: claimant.publicKey.toBase58(),
	bountyId: created.bountyId,
	prNumber: 1,
	commitHash,
	expiresAt,
	nonce,
});
const claimSignature = await send(
	authority,
	[toWeb3Instruction(ed25519), toWeb3Instruction(claim)],
	[claimant],
);
state = await readBounty(programId, created.bountyId);
if (
	state.status !== "ClaimPending" ||
	state.claimant !== claimant.publicKey.toBase58()
)
	throw new Error("The attested claimant was not recorded on-chain");

const approve = await createCreatorActionInstruction({
	programId,
	creator: authority.publicKey.toBase58(),
	bountyId: created.bountyId,
	action: "approveClaim",
});
const approveSignature = await send(authority, [toWeb3Instruction(approve)]);
state = await readBounty(programId, created.bountyId);
if (!state.approved)
	throw new Error("Creator approval was not recorded on-chain");
await waitForChainTime(state.reviewEnds);

const claimantAta = await deriveAssociatedTokenAddress(
	claimant.publicKey.toBase58(),
	SOLANA_DEVNET_USDC_MINT,
);
const treasuryAta = await deriveAssociatedTokenAddress(
	treasury.publicKey.toBase58(),
	SOLANA_DEVNET_USDC_MINT,
);
const [claimantAtaInfo, treasuryAtaInfo] = await Promise.all([
	connection.getAccountInfo(new PublicKey(claimantAta), "confirmed"),
	connection.getAccountInfo(new PublicKey(treasuryAta), "confirmed"),
]);
const ataInstructions = [
	...(claimantAtaInfo
		? []
		: [
				toWeb3Instruction(
					createAssociatedTokenAccountIdempotentInstruction({
						payer: authority.publicKey.toBase58(),
						owner: claimant.publicKey.toBase58(),
						mint: SOLANA_DEVNET_USDC_MINT,
						tokenAccount: claimantAta,
					}),
				),
			]),
	...(treasuryAtaInfo
		? []
		: [
				toWeb3Instruction(
					createAssociatedTokenAccountIdempotentInstruction({
						payer: authority.publicKey.toBase58(),
						owner: treasury.publicKey.toBase58(),
						mint: SOLANA_DEVNET_USDC_MINT,
						tokenAccount: treasuryAta,
					}),
				),
			]),
];
const [claimantBefore, treasuryBefore] = await Promise.all([
	claimantAtaInfo
		? getAccount(connection, new PublicKey(claimantAta), "confirmed").then(
				(account) => account.amount,
			)
		: Promise.resolve(BigInt(0)),
	treasuryAtaInfo
		? getAccount(connection, new PublicKey(treasuryAta), "confirmed").then(
				(account) => account.amount,
			)
		: Promise.resolve(BigInt(0)),
]);
const finalize = await createFinalizeClaimInstruction({
	programId,
	bountyId: created.bountyId,
	claimant: claimant.publicKey.toBase58(),
	feeTreasury: treasury.publicKey.toBase58(),
	mint: SOLANA_DEVNET_USDC_MINT,
});
const payoutSignature = await send(authority, [
	...ataInstructions,
	toWeb3Instruction(finalize),
]);
state = await readBounty(programId, created.bountyId);
const [claimantAfter, treasuryAfter, creatorAfter] = await Promise.all([
	getAccount(connection, new PublicKey(claimantAta), "confirmed").then(
		(account) => account.amount,
	),
	getAccount(connection, new PublicKey(treasuryAta), "confirmed").then(
		(account) => account.amount,
	),
	getAccount(connection, new PublicKey(creatorAtaAddress), "confirmed").then(
		(account) => account.amount,
	),
]);
if (
	state.status !== "Paid" ||
	claimantAfter - claimantBefore !== rewardAmount ||
	treasuryAfter - treasuryBefore !== feeAmount ||
	creatorAtaAmount - creatorAfter !== requiredUsdc
)
	throw new Error(
		"Final on-chain state or exact USDC reward/fee deltas are incorrect",
	);

console.log(`Devnet smoke bounty id: ${created.bountyId.toString()}`);
console.log(`Bounty PDA: ${created.bountyAddress}`);
console.log(`Reward paid: ${rewardAmount.toString()} USDC base units`);
console.log(`Platform fee paid: ${feeAmount.toString()} USDC base units`);
console.log(`Final state: ${state.status}`);
console.log(`Create tx: ${createSignature}`);
console.log(`Fund tx: ${fundSignature}`);
console.log(`Claim tx: ${claimSignature}`);
console.log(`Approve tx: ${approveSignature}`);
console.log(`Payout tx: ${payoutSignature}`);
