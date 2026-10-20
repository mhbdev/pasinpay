import { beforeAll, describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	bigintToLittleEndian,
	createAssociatedTokenAccountIdempotentInstruction,
	createBountyInstruction,
	createClaimInstruction,
	createCreatorActionInstruction,
	createEd25519VerificationInstruction,
	createFinalizeClaimInstruction,
	createFundBountyInstruction,
	createInitializeInstruction,
	createRefundExpiredInstruction,
	createResolveDisputeInstruction,
	decodeSolanaBountyAccount,
	deriveAssociatedTokenAddress,
	deriveBountyAddress,
	encodeSolanaClaimMessage,
	fetchSolanaEscrowConfig,
	SOLANA_DEVNET_NETWORK_DOMAIN,
	type SolanaBountyState,
	signSolanaBytes,
} from "@pasinpay/solana";
import {
	AccountRole,
	createSolanaRpc,
	getBase58Decoder,
	getBase64Encoder,
	type Instruction,
} from "@solana/kit";
import {
	createMint,
	getAccount,
	getOrCreateAssociatedTokenAccount,
	mintTo,
} from "@solana/spl-token";
import {
	Connection,
	Keypair,
	LAMPORTS_PER_SOL,
	PublicKey,
	sendAndConfirmTransaction,
	Transaction,
	TransactionInstruction,
} from "@solana/web3.js";

const endpoint = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(endpoint, "confirmed");
const rpc = createSolanaRpc(endpoint);
const projectRoot = resolve(import.meta.dir, "..");
const providerKeyPath = resolve(projectRoot, "keys/localnet-authority.json");
const programSourcePath = resolve(projectRoot, "programs/pasinpay/src/lib.rs");
let payer: Keypair;
let programId: string;
let mint: PublicKey;
let creator: Keypair;
let claimant: Keypair;
let outsider: Keypair;
let attestor: Keypair;
let treasury: Keypair;
let creatorToken: PublicKey;
let config: NonNullable<Awaited<ReturnType<typeof fetchSolanaEscrowConfig>>>;

function toWeb3Instruction(input: Instruction) {
	return new TransactionInstruction({
		programId: new PublicKey(input.programAddress),
		keys: (input.accounts ?? []).map((meta) => {
			if (!("role" in meta))
				throw new Error(
					"Local E2E transactions do not support account lookup tables",
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

async function send(
	instructions: TransactionInstruction[],
	signers: Keypair[] = [],
) {
	const transaction = new Transaction().add(...instructions);
	transaction.feePayer = payer.publicKey;
	const uniqueSigners = new Map(
		[payer, ...signers].map((signer) => [signer.publicKey.toBase58(), signer]),
	);
	return sendAndConfirmTransaction(
		connection,
		transaction,
		[...uniqueSigners.values()],
		{ commitment: "confirmed" },
	);
}

async function airdrop(key: PublicKey) {
	const signature = await connection.requestAirdrop(key, 3 * LAMPORTS_PER_SOL);
	await connection.confirmTransaction(signature, "confirmed");
}

async function readBounty(id: bigint): Promise<SolanaBountyState> {
	const bountyAddress = await deriveBountyAddress(programId, id);
	const { value } = await rpc
		.getAccountInfo(bountyAddress, {
			commitment: "confirmed",
			encoding: "base64",
		})
		.send();
	if (!value || value.owner !== programId)
		throw new Error(
			`Bounty PDA ${bountyAddress} was not created by the program`,
		);
	return decodeSolanaBountyAccount(
		new Uint8Array(getBase64Encoder().encode(value.data[0])),
	);
}

async function createBounty(
	issueNumber: number,
	deadlineSeconds: bigint,
	reviewWindow: bigint,
) {
	const currentConfig = await fetchSolanaEscrowConfig(rpc, programId);
	if (!currentConfig)
		throw new Error("The local escrow config was not initialized");
	const created = await createBountyInstruction({
		programId,
		creator: creator.publicKey.toBase58(),
		config: currentConfig,
		repositoryHash: new Uint8Array(32).fill(issueNumber),
		issueNumber,
		deadline: deadlineSeconds,
		reviewWindow,
	});
	await send([toWeb3Instruction(created.instruction)], [creator]);
	return { id: created.bountyId, address: created.bountyAddress };
}

async function fundBounty(id: bigint, reward: bigint) {
	const fund = await createFundBountyInstruction({
		programId,
		creator: creator.publicKey.toBase58(),
		bountyId: id,
		rewardAmount: reward,
		mint: mint.toBase58(),
	});
	const fee = (reward * BigInt(config.feeBps)) / BigInt(10_000);
	await mintTo(connection, payer, mint, creatorToken, payer, reward + fee);
	await send([toWeb3Instruction(fund.instruction)], [creator]);
	const state = await readBounty(id);
	expect(state.status).toBe("Funded");
	expect(state.amount).toBe(reward);
	expect(state.feeAmount).toBe(fee);
	expect(state.totalFunded).toBe(reward + fee);
	return { fee, total: reward + fee };
}

async function attestAndClaim(
	id: bigint,
	issueNumber: number,
	claimantKeypair: Keypair,
	prNumber: number,
) {
	const state = await readBounty(id);
	const bountyAddress = await deriveBountyAddress(programId, id);
	const commitHash = new Uint8Array(32).fill(prNumber);
	const nonce = new Uint8Array(32);
	nonce.set(bigintToLittleEndian(BigInt(prNumber), 8));
	const now = BigInt(Math.floor(Date.now() / 1000));
	const expiresAt = now + BigInt(300);
	const message = encodeSolanaClaimMessage({
		programId,
		networkDomain: config.networkDomain,
		bountyAddress,
		bountyId: id,
		repositoryHash: state.repositoryHash,
		issueNumber,
		prNumber,
		commitHash,
		claimant: claimantKeypair.publicKey.toBase58(),
		expiresAt,
		nonce,
	});
	const secretKey = getBase58Decoder().decode(attestor.secretKey);
	const signed = await signSolanaBytes(secretKey, message);
	const ed25519 = createEd25519VerificationInstruction({
		attestor: signed.signer,
		signature: signed.signature,
		message,
	});
	const claimInstruction = await createClaimInstruction({
		programId,
		claimant: claimantKeypair.publicKey.toBase58(),
		bountyId: id,
		prNumber,
		commitHash,
		expiresAt,
		nonce,
	});
	return { state, commitHash, ed25519, claimInstruction, claimantKeypair };
}

async function createRecipientTokenAccounts(state: SolanaBountyState) {
	const claimantToken = await deriveAssociatedTokenAddress(
		state.claimant,
		mint.toBase58(),
	);
	const feeToken = await deriveAssociatedTokenAddress(
		treasury.publicKey.toBase58(),
		mint.toBase58(),
	);
	return [
		toWeb3Instruction(
			createAssociatedTokenAccountIdempotentInstruction({
				payer: payer.publicKey.toBase58(),
				owner: state.claimant,
				mint: mint.toBase58(),
				tokenAccount: claimantToken,
			}),
		),
		toWeb3Instruction(
			createAssociatedTokenAccountIdempotentInstruction({
				payer: payer.publicKey.toBase58(),
				owner: treasury.publicKey.toBase58(),
				mint: mint.toBase58(),
				tokenAccount: feeToken,
			}),
		),
	];
}

async function waitForChainTime(timestamp: bigint) {
	const timeout = Date.now() + 20_000;
	while (Date.now() < timeout) {
		const slot = await connection.getSlot("confirmed");
		const blockTime = await connection.getBlockTime(slot);
		if (blockTime !== null && BigInt(blockTime) >= timestamp) return;
		await new Promise((done) => setTimeout(done, 250));
	}
	throw new Error(`Local validator did not reach timestamp ${timestamp}`);
}

describe("PasinPay Solana escrow end-to-end", () => {
	beforeAll(async () => {
		const [providerSecret, programSource] = await Promise.all([
			readFile(providerKeyPath, "utf8"),
			readFile(programSourcePath, "utf8"),
		]);
		payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(providerSecret)));
		const declaredProgramId = programSource.match(
			/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\);/,
		)?.[1];
		if (!declaredProgramId)
			throw new Error("Could not read the Anchor program ID from lib.rs");
		programId = declaredProgramId;
		const programAccount = await connection.getAccountInfo(
			new PublicKey(programId),
		);
		if (!programAccount?.executable)
			throw new Error(
				"Run `bun run --filter @pasinpay/solana-contract-tests test:e2e` so the escrow program is loaded into localnet first",
			);

		creator = Keypair.generate();
		claimant = Keypair.generate();
		outsider = Keypair.generate();
		attestor = Keypair.generate();
		treasury = Keypair.generate();
		await Promise.all([
			airdrop(payer.publicKey),
			airdrop(creator.publicKey),
			airdrop(claimant.publicKey),
			airdrop(outsider.publicKey),
		]);
		mint = await createMint(
			connection,
			payer,
			payer.publicKey,
			payer.publicKey,
			6,
		);
		const creatorAta = await getOrCreateAssociatedTokenAccount(
			connection,
			payer,
			mint,
			creator.publicKey,
		);
		creatorToken = creatorAta.address;
		const initialized = await fetchSolanaEscrowConfig(rpc, programId);
		if (initialized)
			throw new Error(
				"Local validator must be fresh; config PDA already exists",
			);
		const initialize = await createInitializeInstruction({
			programId,
			authority: payer.publicKey.toBase58(),
			attestor: attestor.publicKey.toBase58(),
			feeTreasury: treasury.publicKey.toBase58(),
			feeBps: 250,
			networkDomain: SOLANA_DEVNET_NETWORK_DOMAIN,
			mint: mint.toBase58(),
		});
		await send([toWeb3Instruction(initialize)]);
		const initializedConfig = await fetchSolanaEscrowConfig(rpc, programId);
		if (!initializedConfig)
			throw new Error(
				"Initialization transaction did not create the config PDA",
			);
		config = initializedConfig;
		expect(config.authority).toBe(payer.publicKey.toBase58());
		expect(config.attestor).toBe(attestor.publicKey.toBase58());
		expect(config.feeTreasury).toBe(treasury.publicKey.toBase58());
		expect(config.mint).toBe(mint.toBase58());
	});

	it("enforces identity and authorization, pays the reward and fee, resolves disputes, refunds expiry, and cancels safely", async () => {
		const now = BigInt(Math.floor(Date.now() / 1000));
		const normal = await createBounty(1, now + BigInt(600), BigInt(2));
		const normalTotals = await fundBounty(normal.id, BigInt(1_000_000));

		const attestation = await attestAndClaim(normal.id, 1, claimant, 1);
		const forgedClaim = await createClaimInstruction({
			programId,
			claimant: outsider.publicKey.toBase58(),
			bountyId: normal.id,
			prNumber: 1,
			commitHash: attestation.commitHash,
			expiresAt: BigInt(Math.floor(Date.now() / 1000)) + BigInt(300),
			nonce: new Uint8Array(32).fill(1),
		});
		await expect(
			send(
				[
					toWeb3Instruction(attestation.ed25519),
					toWeb3Instruction(forgedClaim),
				],
				[outsider],
			),
		).rejects.toThrow();
		expect((await readBounty(normal.id)).status).toBe("Funded");

		await send(
			[
				toWeb3Instruction(attestation.ed25519),
				toWeb3Instruction(attestation.claimInstruction),
			],
			[claimant],
		);
		let state = await readBounty(normal.id);
		expect(state.status).toBe("ClaimPending");
		expect(state.claimant).toBe(claimant.publicKey.toBase58());
		const competingClaim = await attestAndClaim(normal.id, 1, outsider, 99);
		await expect(
			send(
				[
					toWeb3Instruction(competingClaim.ed25519),
					toWeb3Instruction(competingClaim.claimInstruction),
				],
				[outsider],
			),
		).rejects.toThrow();
		state = await readBounty(normal.id);
		expect(state.status).toBe("ClaimPending");
		expect(state.claimant).toBe(claimant.publicKey.toBase58());

		const approve = await createCreatorActionInstruction({
			programId,
			creator: outsider.publicKey.toBase58(),
			bountyId: normal.id,
			action: "approveClaim",
		});
		await expect(
			send([toWeb3Instruction(approve)], [outsider]),
		).rejects.toThrow();
		const creatorApprove = await createCreatorActionInstruction({
			programId,
			creator: creator.publicKey.toBase58(),
			bountyId: normal.id,
			action: "approveClaim",
		});
		await send([toWeb3Instruction(creatorApprove)], [creator]);
		state = await readBounty(normal.id);
		expect(state.approved).toBe(true);
		const finalize = await createFinalizeClaimInstruction({
			programId,
			bountyId: normal.id,
			claimant: claimant.publicKey.toBase58(),
			feeTreasury: treasury.publicKey.toBase58(),
			mint: mint.toBase58(),
		});
		const recipientAtas = await createRecipientTokenAccounts(state);
		await expect(
			send([...recipientAtas, toWeb3Instruction(finalize)]),
		).rejects.toThrow();
		await waitForChainTime(state.reviewEnds);
		await send([...recipientAtas, toWeb3Instruction(finalize)]);
		state = await readBounty(normal.id);
		expect(state.status).toBe("Paid");
		const claimantToken = await deriveAssociatedTokenAddress(
			claimant.publicKey.toBase58(),
			mint.toBase58(),
		);
		const treasuryToken = await deriveAssociatedTokenAddress(
			treasury.publicKey.toBase58(),
			mint.toBase58(),
		);
		expect(
			(await getAccount(connection, new PublicKey(claimantToken))).amount,
		).toBe(BigInt(1_000_000));
		expect(
			(await getAccount(connection, new PublicKey(treasuryToken))).amount,
		).toBe(normalTotals.fee);
		expect(
			(await getAccount(connection, new PublicKey(creatorToken))).amount,
		).toBe(BigInt(0));

		const disputed = await createBounty(
			2,
			BigInt(Math.floor(Date.now() / 1000) + 600),
			BigInt(1),
		);
		const disputeTotals = await fundBounty(disputed.id, BigInt(2_000_000));
		const disputeClaim = await attestAndClaim(disputed.id, 2, claimant, 2);
		await send(
			[
				toWeb3Instruction(disputeClaim.ed25519),
				toWeb3Instruction(disputeClaim.claimInstruction),
			],
			[claimant],
		);
		const dispute = await createCreatorActionInstruction({
			programId,
			creator: creator.publicKey.toBase58(),
			bountyId: disputed.id,
			action: "disputeClaim",
		});
		await send([toWeb3Instruction(dispute)], [creator]);
		state = await readBounty(disputed.id);
		expect(state.status).toBe("Disputed");
		const resolve = await createResolveDisputeInstruction({
			programId,
			authority: payer.publicKey.toBase58(),
			bountyId: disputed.id,
			creator: creator.publicKey.toBase58(),
			claimant: claimant.publicKey.toBase58(),
			feeTreasury: treasury.publicKey.toBase58(),
			claimantBps: 5_000,
			mint: mint.toBase58(),
		});
		const disputedCreatorToken = await deriveAssociatedTokenAddress(
			creator.publicKey.toBase58(),
			mint.toBase58(),
		);
		const disputedClaimantToken = await deriveAssociatedTokenAddress(
			claimant.publicKey.toBase58(),
			mint.toBase58(),
		);
		const disputedFeeToken = await deriveAssociatedTokenAddress(
			treasury.publicKey.toBase58(),
			mint.toBase58(),
		);
		const resolveAtas = [
			{
				tokenAccount: disputedCreatorToken,
				owner: creator.publicKey.toBase58(),
			},
			{
				tokenAccount: disputedClaimantToken,
				owner: claimant.publicKey.toBase58(),
			},
			{
				tokenAccount: disputedFeeToken,
				owner: treasury.publicKey.toBase58(),
			},
		].map(({ tokenAccount, owner }) =>
			toWeb3Instruction(
				createAssociatedTokenAccountIdempotentInstruction({
					payer: payer.publicKey.toBase58(),
					owner,
					mint: mint.toBase58(),
					tokenAccount,
				}),
			),
		);
		const disputedCreatorBefore = (
			await getAccount(connection, new PublicKey(disputedCreatorToken))
		).amount;
		const disputedClaimantBefore = (
			await getAccount(connection, new PublicKey(disputedClaimantToken))
		).amount;
		const disputedFeeBefore = (
			await getAccount(connection, new PublicKey(disputedFeeToken))
		).amount;
		const unauthorizedResolve = await createResolveDisputeInstruction({
			programId,
			authority: outsider.publicKey.toBase58(),
			bountyId: disputed.id,
			creator: creator.publicKey.toBase58(),
			claimant: claimant.publicKey.toBase58(),
			feeTreasury: treasury.publicKey.toBase58(),
			claimantBps: 5_000,
			mint: mint.toBase58(),
		});
		await expect(
			send(
				[...resolveAtas, toWeb3Instruction(unauthorizedResolve)],
				[outsider],
			),
		).rejects.toThrow();
		await send([...resolveAtas, toWeb3Instruction(resolve)]);
		state = await readBounty(disputed.id);
		expect(state.status).toBe("Paid");
		expect(
			(await getAccount(connection, new PublicKey(disputedCreatorToken)))
				.amount,
		).toBe(disputedCreatorBefore + BigInt(1_000_000));
		expect(
			(await getAccount(connection, new PublicKey(disputedClaimantToken)))
				.amount,
		).toBe(disputedClaimantBefore + BigInt(1_000_000));
		expect(
			(await getAccount(connection, new PublicKey(disputedFeeToken))).amount,
		).toBe(disputedFeeBefore + disputeTotals.fee);

		const refund = await createBounty(
			3,
			BigInt(Math.floor(Date.now() / 1000) + 600),
			BigInt(1),
		);
		const refundTotals = await fundBounty(refund.id, BigInt(500_000));
		const refundClaim = await attestAndClaim(refund.id, 3, claimant, 3);
		await send(
			[
				toWeb3Instruction(refundClaim.ed25519),
				toWeb3Instruction(refundClaim.claimInstruction),
			],
			[claimant],
		);
		const disputeForRefund = await createCreatorActionInstruction({
			programId,
			creator: creator.publicKey.toBase58(),
			bountyId: refund.id,
			action: "disputeClaim",
		});
		await send([toWeb3Instruction(disputeForRefund)], [creator]);
		const refundDispute = await createResolveDisputeInstruction({
			programId,
			authority: payer.publicKey.toBase58(),
			bountyId: refund.id,
			creator: creator.publicKey.toBase58(),
			claimant: claimant.publicKey.toBase58(),
			feeTreasury: treasury.publicKey.toBase58(),
			claimantBps: 0,
			mint: mint.toBase58(),
		});
		const refundState = await readBounty(refund.id);
		expect(refundState.status).toBe("Disputed");
		const refundCreatorToken = await deriveAssociatedTokenAddress(
			creator.publicKey.toBase58(),
			mint.toBase58(),
		);
		const refundClaimantToken = await deriveAssociatedTokenAddress(
			claimant.publicKey.toBase58(),
			mint.toBase58(),
		);
		const refundFeeToken = await deriveAssociatedTokenAddress(
			treasury.publicKey.toBase58(),
			mint.toBase58(),
		);
		const refundAtas = [
			{ tokenAccount: refundCreatorToken, owner: creator.publicKey.toBase58() },
			{
				tokenAccount: refundClaimantToken,
				owner: claimant.publicKey.toBase58(),
			},
			{ tokenAccount: refundFeeToken, owner: treasury.publicKey.toBase58() },
		].map(({ tokenAccount, owner }) =>
			toWeb3Instruction(
				createAssociatedTokenAccountIdempotentInstruction({
					payer: payer.publicKey.toBase58(),
					owner,
					mint: mint.toBase58(),
					tokenAccount,
				}),
			),
		);
		const refundCreatorBefore = (
			await getAccount(connection, new PublicKey(refundCreatorToken))
		).amount;
		const refundFeeBefore = (
			await getAccount(connection, new PublicKey(refundFeeToken))
		).amount;
		await send([...refundAtas, toWeb3Instruction(refundDispute)]);
		expect((await readBounty(refund.id)).status).toBe("Refunded");
		expect(
			(await getAccount(connection, new PublicKey(refundCreatorToken))).amount,
		).toBe(refundCreatorBefore + refundTotals.total);
		expect(
			(await getAccount(connection, new PublicKey(refundFeeToken))).amount,
		).toBe(refundFeeBefore);

		const expiredDeadline = BigInt(Math.floor(Date.now() / 1000) + 20);
		const expired = await createBounty(4, expiredDeadline, BigInt(1));
		const expiredTotals = await fundBounty(expired.id, BigInt(250_000));
		const expiredCreatorBeforeRefund = (
			await getAccount(connection, creatorToken)
		).amount;
		await waitForChainTime(expiredDeadline + BigInt(1));
		const expiredRefund = await createRefundExpiredInstruction({
			programId,
			payer: payer.publicKey.toBase58(),
			bountyId: expired.id,
			creator: creator.publicKey.toBase58(),
			mint: mint.toBase58(),
		});
		await send([toWeb3Instruction(expiredRefund)]);
		expect((await readBounty(expired.id)).status).toBe("Refunded");
		expect((await getAccount(connection, creatorToken)).amount).toBe(
			expiredCreatorBeforeRefund + expiredTotals.total,
		);

		const cancel = await createBounty(
			5,
			BigInt(Math.floor(Date.now() / 1000) + 600),
			BigInt(1),
		);
		const cancelInstruction = await createCreatorActionInstruction({
			programId,
			creator: creator.publicKey.toBase58(),
			bountyId: cancel.id,
			action: "cancelBounty",
		});
		await send([toWeb3Instruction(cancelInstruction)], [creator]);
		expect((await readBounty(cancel.id)).status).toBe("Cancelled");
		const cancelledFunding = await createFundBountyInstruction({
			programId,
			creator: creator.publicKey.toBase58(),
			bountyId: cancel.id,
			rewardAmount: BigInt(100_000),
			mint: mint.toBase58(),
		});
		await expect(
			send([toWeb3Instruction(cancelledFunding.instruction)], [creator]),
		).rejects.toThrow();
		expect((await readBounty(cancel.id)).status).toBe("Cancelled");
	}, 120_000);
});
