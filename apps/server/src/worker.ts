import { createHash, randomBytes } from "node:crypto";
import { claimDigest, escrowAbi, verifyClaimSignature } from "@pasinpay/chain";
import {
	account,
	bounty,
	bountyParticipant,
	chainCursor,
	claim,
	githubInstallation,
	job as jobTable,
	repository,
	settlement,
	walletLink,
} from "@pasinpay/db/schema/index";
import {
	bigintToLittleEndian,
	bytesToHex,
	decodeSolanaBountyAccount,
	deriveBountyAddress,
	encodeSolanaClaimMessage,
	fetchSolanaEscrowConfig,
	hexToBytes,
	SOLANA_DEVNET_ID,
	SOLANA_DEVNET_NETWORK_DOMAIN,
	SOLANA_DEVNET_USDC_MINT,
	signSolanaBytes,
} from "@pasinpay/solana";
import {
	createSolanaRpc,
	getAddressDecoder,
	getBase58Decoder,
	getBase64Encoder,
	address as solanaAddress,
} from "@solana/kit";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Address, Hex } from "viem";
import { ENV } from "./env.server";
import { getContractAttestorAddress, signClaim } from "./lib/attestor";
import {
	getAttestationExpiry,
	isAttestationExpired,
} from "./lib/claim-attestation";
import {
	createInstallationToken,
	githubRequest,
	listRepositoryPullRequests,
} from "./lib/github";
import {
	type ChainRuntime,
	configuredChainRuntimes,
	configuredSolanaDevnetConfig,
	db,
	getChainRuntime,
} from "./services";

type PullRequestPayload = {
	installation?: { id: number };
	repository?: { full_name?: string };
	pull_request?: {
		merged?: boolean;
		merged_at?: string | null;
		merge_commit_sha?: string | null;
		number?: number;
		title?: string;
		html_url?: string;
		user?: { login?: string; id?: number };
	};
};

type GitHubJobPayload = {
	deliveryId?: string;
	event?: string;
	payload: PullRequestPayload;
};

const paidEvent = {
	type: "event",
	name: "BountyPaid",
	inputs: [
		{ indexed: true, name: "bountyId", type: "uint256" },
		{ indexed: true, name: "recipient", type: "address" },
		{ indexed: false, name: "amount", type: "uint128" },
	],
} as const;
const refundedEvent = {
	type: "event",
	name: "BountyRefunded",
	inputs: [
		{ indexed: true, name: "bountyId", type: "uint256" },
		{ indexed: false, name: "amount", type: "uint128" },
	],
} as const;
const fundedEvent = {
	type: "event",
	name: "BountyFunded",
	inputs: [
		{ indexed: true, name: "bountyId", type: "uint256" },
		{ indexed: false, name: "rewardAmount", type: "uint128" },
		{ indexed: false, name: "feeAmount", type: "uint128" },
		{ indexed: false, name: "totalAmount", type: "uint128" },
	],
} as const;
const feePaidEvent = {
	type: "event",
	name: "PlatformFeePaid",
	inputs: [
		{ indexed: true, name: "bountyId", type: "uint256" },
		{ indexed: true, name: "treasury", type: "address" },
		{ indexed: false, name: "amount", type: "uint128" },
	],
} as const;
const disputedEvent = {
	type: "event",
	name: "ClaimDisputed",
	inputs: [{ indexed: true, name: "bountyId", type: "uint256" }],
} as const;
const cancelledEvent = {
	type: "event",
	name: "BountyCancelled",
	inputs: [{ indexed: true, name: "bountyId", type: "uint256" }],
} as const;
const claimSubmittedEvent = {
	type: "event",
	name: "ClaimSubmitted",
	inputs: [
		{ indexed: true, name: "bountyId", type: "uint256" },
		{ indexed: true, name: "claimant", type: "address" },
		{ indexed: false, name: "prNumber", type: "uint256" },
		{ indexed: false, name: "commitHash", type: "bytes32" },
	],
} as const;

async function syncChainEvents(runtime: ChainRuntime) {
	const { config: chainConfig, publicClient } = runtime;
	if (
		chainConfig.escrowAddress === "0x0000000000000000000000000000000000000000"
	)
		return;
	const [cursor] = await db
		.select()
		.from(chainCursor)
		.where(eq(chainCursor.id, `escrow:${chainConfig.id}`));
	const latest = await publicClient.getBlockNumber();
	const fromBlock =
		cursor && cursor.chainId === chainConfig.id
			? cursor.lastBlock + BigInt(1)
			: latest > BigInt(1000)
				? latest - BigInt(1000)
				: BigInt(0);
	if (fromBlock > latest) return;
	const [paid, refunded, funded, disputed, cancelled, claimSubmitted, feePaid] =
		await Promise.all([
			publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: paidEvent,
				fromBlock,
				toBlock: latest,
			}),
			publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: refundedEvent,
				fromBlock,
				toBlock: latest,
			}),
			publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: fundedEvent,
				fromBlock,
				toBlock: latest,
			}),
			publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: disputedEvent,
				fromBlock,
				toBlock: latest,
			}),
			publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: cancelledEvent,
				fromBlock,
				toBlock: latest,
			}),
			publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: claimSubmittedEvent,
				fromBlock,
				toBlock: latest,
			}),
			publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: feePaidEvent,
				fromBlock,
				toBlock: latest,
			}),
		]);
	const feeByBounty = new Map<bigint, bigint>();
	for (const log of feePaid)
		if (log.args.bountyId !== undefined && log.args.amount !== undefined)
			feeByBounty.set(log.args.bountyId, log.args.amount);
	for (const log of funded)
		if (log.args.bountyId !== undefined)
			await db
				.update(bounty)
				.set({
					status: "Funded",
					feeAmount: log.args.feeAmount ?? BigInt(0),
					totalFunded:
						log.args.totalAmount ?? log.args.rewardAmount ?? BigInt(0),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(bounty.onchainBountyId, log.args.bountyId),
						eq(bounty.chainId, chainConfig.id),
						eq(bounty.escrowAddress, chainConfig.escrowAddress),
					),
				);
	for (const log of refunded)
		if (log.args.bountyId !== undefined)
			await db
				.update(bounty)
				.set({ status: "Refunded", updatedAt: new Date() })
				.where(
					and(
						eq(bounty.onchainBountyId, log.args.bountyId),
						eq(bounty.chainId, chainConfig.id),
						eq(bounty.escrowAddress, chainConfig.escrowAddress),
					),
				);
	for (const log of disputed)
		if (log.args.bountyId !== undefined)
			await db
				.update(bounty)
				.set({ status: "Disputed", updatedAt: new Date() })
				.where(
					and(
						eq(bounty.onchainBountyId, log.args.bountyId),
						eq(bounty.chainId, chainConfig.id),
						eq(bounty.escrowAddress, chainConfig.escrowAddress),
					),
				);
	for (const log of cancelled)
		if (log.args.bountyId !== undefined)
			await db
				.update(bounty)
				.set({ status: "Cancelled", updatedAt: new Date() })
				.where(
					and(
						eq(bounty.onchainBountyId, log.args.bountyId),
						eq(bounty.chainId, chainConfig.id),
						eq(bounty.escrowAddress, chainConfig.escrowAddress),
					),
				);
	for (const log of claimSubmitted)
		if (log.args.bountyId !== undefined && log.args.claimant) {
			const onchain = await publicClient.readContract({
				address: chainConfig.escrowAddress,
				abi: [
					{
						type: "function",
						name: "bounties",
						stateMutability: "view",
						inputs: [{ name: "", type: "uint256" }],
						outputs: [
							{ name: "creator", type: "address" },
							{ name: "amount", type: "uint128" },
							{ name: "feeAmount", type: "uint128" },
							{ name: "totalFunded", type: "uint128" },
							{ name: "deadline", type: "uint64" },
							{ name: "reviewWindow", type: "uint64" },
							{ name: "reviewEnds", type: "uint64" },
							{ name: "issueNumber", type: "uint32" },
							{ name: "repositoryHash", type: "bytes32" },
							{ name: "claimant", type: "address" },
							{ name: "claimDigest", type: "bytes32" },
							{ name: "status", type: "uint8" },
							{ name: "approved", type: "bool" },
						],
					},
				],
				functionName: "bounties",
				args: [log.args.bountyId],
			});
			await db
				.update(bounty)
				.set({
					status: "ClaimPending",
					claimantWallet: log.args.claimant,
					claimDigest: onchain[10],
					reviewEnds: new Date(Number(onchain[6]) * 1000),
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(bounty.onchainBountyId, log.args.bountyId),
						eq(bounty.chainId, chainConfig.id),
						eq(bounty.escrowAddress, chainConfig.escrowAddress),
					),
				);
		}
	for (const log of paid)
		if (log.args.bountyId !== undefined && log.args.recipient) {
			const [row] = await db
				.update(bounty)
				.set({
					status: "Paid",
					claimantWallet: log.args.recipient,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(bounty.onchainBountyId, log.args.bountyId),
						eq(bounty.chainId, chainConfig.id),
						eq(bounty.escrowAddress, chainConfig.escrowAddress),
					),
				)
				.returning();
			if (row && log.args.amount !== undefined && log.transactionHash)
				await db
					.insert(settlement)
					.values({
						bountyId: row.id,
						recipient: log.args.recipient,
						amount: log.args.amount,
						feeAmount: feeByBounty.get(log.args.bountyId) ?? BigInt(0),
						transactionHash: log.transactionHash,
					})
					.onConflictDoNothing();
		}
	await db
		.insert(chainCursor)
		.values({
			id: `escrow:${chainConfig.id}`,
			chainId: chainConfig.id,
			lastBlock: latest,
		})
		.onConflictDoUpdate({
			target: chainCursor.id,
			set: { lastBlock: latest, updatedAt: new Date() },
		});
}

function readU64LittleEndian(bytes: Uint8Array, offset: number) {
	let value = BigInt(0);
	for (let index = 7; index >= 0; index -= 1) {
		value = (value << BigInt(8)) | BigInt(bytes[offset + index] ?? 0);
	}
	return value;
}

async function syncSolanaBounties() {
	const config = configuredSolanaDevnetConfig;
	if (!config?.programId) return;
	const rpc = createSolanaRpc(config.rpcUrl);
	const rows = await db
		.select()
		.from(bounty)
		.where(eq(bounty.chainId, SOLANA_DEVNET_ID));
	const bountyPaidDiscriminator = new Uint8Array(
		createHash("sha256").update("event:BountyPaid").digest().subarray(0, 8),
	);
	const feePaidDiscriminator = new Uint8Array(
		createHash("sha256")
			.update("event:PlatformFeePaid")
			.digest()
			.subarray(0, 8),
	);
	const addressDecoder = getAddressDecoder();

	for (const row of rows) {
		if (row.onchainBountyId === null) continue;
		if (row.escrowAddress && row.escrowAddress !== config.programId) continue;
		const bountyAddress = await deriveBountyAddress(
			config.programId,
			row.onchainBountyId,
		);
		const { value: accountInfo } = await rpc
			.getAccountInfo(solanaAddress(bountyAddress), {
				commitment: "confirmed",
				encoding: "base64",
			})
			.send();
		if (!accountInfo || accountInfo.owner !== solanaAddress(config.programId))
			continue;
		const state = decodeSolanaBountyAccount(
			new Uint8Array(getBase64Encoder().encode(accountInfo.data[0])),
		);
		const claimant =
			state.claimant === "11111111111111111111111111111111"
				? null
				: state.claimant;
		const digest = state.claimDigest.some((byte) => byte !== 0)
			? bytesToHex(state.claimDigest)
			: null;
		await db
			.update(bounty)
			.set({
				status: state.status,
				claimantWallet: claimant,
				claimDigest: digest,
				reviewEnds:
					state.reviewEnds > BigInt(0)
						? new Date(Number(state.reviewEnds) * 1000)
						: null,
				updatedAt: new Date(),
			})
			.where(eq(bounty.id, row.id));

		if (state.status !== "Paid") continue;
		const [existingSettlement] = await db
			.select({ id: settlement.id })
			.from(settlement)
			.where(eq(settlement.bountyId, row.id))
			.limit(1);
		if (existingSettlement) continue;
		const [latest] = await rpc
			.getSignaturesForAddress(solanaAddress(bountyAddress), {
				commitment: "confirmed",
				limit: 10,
			})
			.send();
		if (!latest || latest.err) continue;
		const transaction = await rpc
			.getTransaction(latest.signature as import("@solana/kit").Signature, {
				commitment: "confirmed",
				encoding: "json",
				maxSupportedTransactionVersion: 0,
			})
			.send();
		const logs = transaction?.meta?.logMessages ?? [];
		let paidRecipient: string | null = null;
		let paidAmount: bigint | null = null;
		let paidFee = BigInt(0);
		for (const log of logs) {
			const match = log.match(/^Program data: ([A-Za-z0-9+/=]+)$/);
			if (!match?.[1]) continue;
			const data = new Uint8Array(getBase64Encoder().encode(match[1]));
			if (data.length < 56) continue;
			const id = readU64LittleEndian(data, 8);
			if (id !== row.onchainBountyId) continue;
			if (
				bountyPaidDiscriminator.every((value, index) => data[index] === value)
			) {
				paidRecipient = addressDecoder.decode(data.slice(16, 48));
				paidAmount = readU64LittleEndian(data, 48);
			} else if (
				feePaidDiscriminator.every((value, index) => data[index] === value)
			) {
				paidFee = readU64LittleEndian(data, 48);
			}
		}
		if (!paidRecipient || paidAmount === null) continue;
		await db
			.insert(settlement)
			.values({
				bountyId: row.id,
				recipient: paidRecipient,
				amount: paidAmount,
				feeAmount: paidFee,
				transactionHash: latest.signature,
			})
			.onConflictDoNothing();
	}
}

function shaToBytes32(sha: string): Hex {
	if (!/^[a-f0-9]{40}$/i.test(sha))
		throw new Error("GitHub did not provide a valid merge commit SHA");
	return `0x${sha.toLowerCase().padStart(64, "0")}` as Hex;
}

async function processSolanaGitHubClaim(
	bountyRow: typeof bounty.$inferSelect,
	jobPayload: GitHubJobPayload,
	pr: NonNullable<PullRequestPayload["pull_request"]>,
	repositoryName: string,
) {
	const config = configuredSolanaDevnetConfig;
	if (!config?.programId || !config.feeTreasury) return;
	if (
		bountyRow.chainId !== SOLANA_DEVNET_ID ||
		bountyRow.onchainBountyId === null ||
		(bountyRow.escrowAddress && bountyRow.escrowAddress !== config.programId)
	)
		return;
	if (new Date() >= bountyRow.deadline)
		throw new Error("Solana bounty deadline has passed");

	const [githubAccount] = await db
		.select()
		.from(account)
		.where(
			and(
				eq(account.providerId, "github"),
				eq(account.accountId, String(pr.user?.id ?? "")),
			),
		)
		.limit(1);
	if (!githubAccount)
		throw new Error(
			`GitHub user ${pr.user?.login ?? "unknown"} is not linked to a PasinPay account`,
		);
	if (bountyRow.joiningPasswordSalt || bountyRow.joiningPasswordHash) {
		const [participant] = await db
			.select({ id: bountyParticipant.id })
			.from(bountyParticipant)
			.where(
				and(
					eq(bountyParticipant.bountyId, bountyRow.id),
					eq(bountyParticipant.userId, githubAccount.userId),
					eq(bountyParticipant.githubAccountId, String(pr.user?.id ?? "")),
				),
			)
			.limit(1);
		if (!participant) return;
	}

	const [wallet] = await db
		.select()
		.from(walletLink)
		.where(
			and(
				eq(walletLink.userId, githubAccount.userId),
				eq(walletLink.chainId, SOLANA_DEVNET_ID),
			),
		)
		.limit(1);
	if (!wallet)
		throw new Error(
			`GitHub user ${pr.user?.login ?? "unknown"} has no linked Solana wallet`,
		);

	const [existingClaim] = await db
		.select()
		.from(claim)
		.where(eq(claim.bountyId, bountyRow.id))
		.limit(1);
	if (existingClaim && existingClaim.githubPrNumber !== pr.number) return;
	if (
		existingClaim &&
		existingClaim.githubPrNumber === pr.number &&
		!isAttestationExpired(existingClaim.attestationExpiresAt)
	)
		return;

	const rpc = createSolanaRpc(config.rpcUrl);
	const onchainConfig = await fetchSolanaEscrowConfig(rpc, config.programId);
	if (!onchainConfig)
		throw new Error("Solana escrow config account is not initialized");
	if (
		onchainConfig.mint !== SOLANA_DEVNET_USDC_MINT ||
		onchainConfig.feeTreasury !== config.feeTreasury ||
		onchainConfig.feeBps !== config.feeBps ||
		onchainConfig.networkDomain.some(
			(byte, index) => byte !== SOLANA_DEVNET_NETWORK_DOMAIN[index],
		)
	)
		throw new Error(
			"Solana server and on-chain escrow configuration do not match",
		);
	const bountyAddress = await deriveBountyAddress(
		config.programId,
		bountyRow.onchainBountyId,
	);
	const { value: bountyAccount } = await rpc
		.getAccountInfo(solanaAddress(bountyAddress), {
			commitment: "confirmed",
			encoding: "base64",
		})
		.send();
	if (!bountyAccount || bountyAccount.owner !== solanaAddress(config.programId))
		throw new Error(
			"The Solana bounty account is missing or owned by another program",
		);
	const state = decodeSolanaBountyAccount(
		new Uint8Array(getBase64Encoder().encode(bountyAccount.data[0])),
	);
	const expectedRepositoryHash = hexToBytes(bountyRow.repositoryHash, 32);
	if (
		state.id !== bountyRow.onchainBountyId ||
		state.status !== "Funded" ||
		state.claimant !== "11111111111111111111111111111111" ||
		state.repositoryHash.some(
			(byte, index) => byte !== expectedRepositoryHash[index],
		)
	)
		return;

	const privateKey = ENV.PASINPAY_SOLANA_DEVNET_ATTESTOR_PRIVATE_KEY;
	if (!privateKey)
		throw new Error(
			"Solana Devnet claim attestor private key is not configured",
		);
	const nonceValue =
		BigInt(`0x${randomBytes(8).toString("hex")}`) &
		((BigInt(1) << BigInt(63)) - BigInt(1));
	const nonce = new Uint8Array(32);
	nonce.set(bigintToLittleEndian(nonceValue, 8));
	const attestationExpiresAt = getAttestationExpiry(bountyRow.deadline);
	const expiresAt = BigInt(Math.floor(attestationExpiresAt.getTime() / 1000));
	const mergeCommit = shaToBytes32(pr.merge_commit_sha ?? "");
	const message = encodeSolanaClaimMessage({
		programId: config.programId,
		networkDomain: onchainConfig.networkDomain,
		bountyAddress,
		bountyId: state.id,
		repositoryHash: state.repositoryHash,
		issueNumber: state.issueNumber,
		prNumber: pr.number ?? 0,
		commitHash: hexToBytes(mergeCommit, 32),
		claimant: wallet.walletAddress,
		expiresAt,
		nonce,
	});
	const signed = await signSolanaBytes(privateKey, message);
	if (signed.signer !== onchainConfig.attestor)
		throw new Error(
			"The configured Solana attestor key does not match the on-chain trusted attestor",
		);
	const signature = getBase58Decoder().decode(signed.signature);
	const digest = bytesToHex(
		new Uint8Array(createHash("sha256").update(message).digest()),
	);
	const deliveryId = jobPayload.deliveryId ?? "solana-reconcile";
	const evidence = {
		repository: repositoryName,
		issueNumber: bountyRow.issueNumber,
		prNumber: pr.number,
		commitHash: pr.merge_commit_sha,
		authorLogin: pr.user?.login,
		prUrl: pr.html_url,
	};

	await db.transaction(async (tx) => {
		if (existingClaim) {
			await tx
				.update(claim)
				.set({
					mergeCommitSha: pr.merge_commit_sha ?? "",
					claimantWallet: wallet.walletAddress,
					attestationDigest: digest,
					attestationSignature: signature,
					attestationNonce: nonceValue,
					attestationExpiresAt,
					githubDeliveryId: deliveryId,
					evidence,
				})
				.where(eq(claim.id, existingClaim.id));
		} else {
			const [inserted] = await tx
				.insert(claim)
				.values({
					bountyId: bountyRow.id,
					githubPrNumber: pr.number ?? 0,
					mergeCommitSha: pr.merge_commit_sha ?? "",
					claimantWallet: wallet.walletAddress,
					attestationDigest: digest,
					attestationSignature: signature,
					attestationNonce: nonceValue,
					attestationExpiresAt,
					githubDeliveryId: deliveryId,
					evidence,
				})
				.onConflictDoNothing({ target: claim.bountyId })
				.returning({ id: claim.id });
			if (!inserted) return;
		}
		await tx
			.update(bounty)
			.set({
				claimantWallet: wallet.walletAddress,
				claimDigest: digest,
				updatedAt: new Date(),
			})
			.where(eq(bounty.id, bountyRow.id));
	});
}

async function processGitHubJob(job: typeof jobTable.$inferSelect) {
	const jobPayload = job.payload as GitHubJobPayload;
	const payload = jobPayload.payload;
	const pr = payload.pull_request;
	const repository = payload.repository?.full_name;
	if (
		!pr?.merged ||
		!pr.merge_commit_sha ||
		!pr.number ||
		!repository ||
		!pr.user?.login
	)
		return;
	const bountyMatch = pr.title?.match(/\[PasinPay\s+#(\d+)\]/i);
	if (!bountyMatch) return;
	const bountyNumber = bountyMatch[1];
	if (!bountyNumber) return;
	if (payload.installation?.id) {
		const token = await createInstallationToken(
			String(payload.installation.id),
		);
		const verified = await githubRequest<{
			merged: boolean;
			merge_commit_sha: string | null;
			title: string;
		}>(`/repos/${repository}/pulls/${pr.number}`, token);
		if (
			!verified.merged ||
			verified.merge_commit_sha !== pr.merge_commit_sha ||
			verified.title !== pr.title
		)
			throw new Error("GitHub PR evidence changed during verification");
	}

	const [bountyRow] = await db
		.select()
		.from(bounty)
		.where(
			and(
				eq(bounty.repository, repository),
				eq(bounty.issueNumber, Number(bountyNumber)),
				eq(bounty.status, "Funded"),
			),
		)
		.limit(1);
	if (
		!bountyRow ||
		bountyRow.onchainBountyId === null ||
		bountyRow.repository.toLowerCase() !== repository.toLowerCase()
	)
		return;
	if (bountyRow.chainId === SOLANA_DEVNET_ID) {
		return processSolanaGitHubClaim(bountyRow, jobPayload, pr, repository);
	}
	const runtime = getChainRuntime(bountyRow.chainId);
	const { config: chainConfig, publicClient } = runtime;
	if (
		bountyRow.escrowAddress &&
		bountyRow.escrowAddress.toLowerCase() !==
			runtime.config.escrowAddress.toLowerCase()
	)
		return;
	const escrowAddress = (bountyRow.escrowAddress ??
		chainConfig.escrowAddress) as Address;
	const onchainBountyId = bountyRow.onchainBountyId;
	const prNumber = pr.number;
	const mergeCommitSha = pr.merge_commit_sha;
	if (new Date() >= bountyRow.deadline)
		throw new Error("Bounty deadline has passed");

	const [githubAccount] = await db
		.select()
		.from(account)
		.where(
			and(
				eq(account.providerId, "github"),
				eq(account.accountId, String(pr.user.id ?? "")),
			),
		)
		.limit(1);
	if (!githubAccount)
		throw new Error(
			`GitHub user ${pr.user.login} is not linked to a PasinPay account`,
		);
	if (bountyRow.joiningPasswordSalt || bountyRow.joiningPasswordHash) {
		const [participant] = await db
			.select({ id: bountyParticipant.id })
			.from(bountyParticipant)
			.where(
				and(
					eq(bountyParticipant.bountyId, bountyRow.id),
					eq(bountyParticipant.userId, githubAccount.userId),
					eq(bountyParticipant.githubAccountId, String(pr.user.id)),
				),
			)
			.limit(1);
		if (!participant) return;
	}
	const [wallet] = await db
		.select()
		.from(walletLink)
		.where(eq(walletLink.userId, githubAccount.userId))
		.limit(1);
	if (!wallet)
		throw new Error(`GitHub user ${pr.user.login} has no linked wallet`);

	const onchainBounty = await publicClient.readContract({
		address: escrowAddress,
		abi: escrowAbi,
		functionName: "bounties",
		args: [onchainBountyId],
	});
	// The database can briefly lag chain reconciliation. Never refresh or
	// create an attestation once the escrow has moved beyond Funded or already
	// contains a claim. The contract remains the final authority at submission.
	if (
		Number(onchainBounty[11]) !== 1 ||
		onchainBounty[9] !== "0x0000000000000000000000000000000000000000" ||
		onchainBounty[10] !==
			"0x0000000000000000000000000000000000000000000000000000000000000000"
	)
		return;
	const mergeCommit = shaToBytes32(pr.merge_commit_sha);
	const attestationExpiresAt = getAttestationExpiry(bountyRow.deadline);
	const expiresAt = BigInt(Math.floor(attestationExpiresAt.getTime() / 1000));
	const message = {
		bountyId: onchainBountyId,
		repositoryHash: bountyRow.repositoryHash as Hex,
		issueNumber: bountyRow.issueNumber,
		prNumber: BigInt(prNumber),
		commitHash: mergeCommit,
		recipient: wallet.walletAddress as `0x${string}`,
		expiresAt: BigInt(expiresAt),
		// The contract accepts a uint256 nonce, while Postgres stores the
		// mirrored nonce in a signed bigint. Keep it positive and within the
		// database range; uniqueness and replay protection remain enforced by
		// the typed digest and the contract's one-time settlement state.
		nonce: BigInt(`0x${randomBytes(8).toString("hex")}`) & ((1n << 63n) - 1n),
	};
	const [existingClaim] = await db
		.select()
		.from(claim)
		.where(
			and(eq(claim.bountyId, bountyRow.id), eq(claim.githubPrNumber, prNumber)),
		)
		.limit(1);
	if (
		existingClaim &&
		!isAttestationExpired(existingClaim.attestationExpiresAt)
	) {
		const existingMessage = {
			bountyId: onchainBountyId,
			repositoryHash: bountyRow.repositoryHash as Hex,
			issueNumber: bountyRow.issueNumber,
			prNumber: BigInt(existingClaim.githubPrNumber),
			commitHash: shaToBytes32(existingClaim.mergeCommitSha),
			recipient: existingClaim.claimantWallet as Address,
			expiresAt: BigInt(
				Math.floor(existingClaim.attestationExpiresAt.getTime() / 1000),
			),
			nonce: existingClaim.attestationNonce,
		};
		const attestor = await getContractAttestorAddress(runtime);
		const isTrusted = await verifyClaimSignature(
			runtime.config.id,
			escrowAddress,
			existingMessage,
			existingClaim.attestationSignature as Hex,
			attestor,
		);
		if (isTrusted) return;
	}
	const { signature } = await signClaim(message, runtime);
	const digest = claimDigest(runtime.config.id, escrowAddress, message);

	await db.transaction(async (tx) => {
		if (existingClaim) {
			// A merged PR can remain valid while a contributor is away for more
			// than the one-hour attestation window. Refresh only the expired
			// attestation; the unique bounty constraint still guarantees that a
			// competing PR cannot replace the winner.
			await tx
				.update(claim)
				.set({
					mergeCommitSha,
					claimantWallet: wallet.walletAddress,
					attestationDigest: digest,
					attestationSignature: signature,
					attestationNonce: message.nonce,
					attestationExpiresAt,
					githubDeliveryId: jobPayload.deliveryId ?? job.id,
					evidence: {
						repository,
						issueNumber: bountyRow.issueNumber,
						prNumber: pr.number,
						commitHash: pr.merge_commit_sha,
						authorLogin: pr.user?.login,
						prUrl: pr.html_url,
					},
				})
				.where(eq(claim.id, existingClaim.id));
			await tx
				.update(bounty)
				.set({
					claimantWallet: wallet.walletAddress,
					claimDigest: digest,
					updatedAt: new Date(),
				})
				.where(eq(bounty.id, bountyRow.id));
			return;
		}
		const [inserted] = await tx
			.insert(claim)
			.values({
				bountyId: bountyRow.id,
				githubPrNumber: prNumber,
				mergeCommitSha,
				claimantWallet: wallet.walletAddress,
				attestationDigest: digest,
				attestationSignature: signature,
				attestationNonce: message.nonce,
				attestationExpiresAt,
				githubDeliveryId: jobPayload.deliveryId ?? job.id,
				evidence: {
					repository,
					issueNumber: bountyRow.issueNumber,
					prNumber: pr.number,
					commitHash: pr.merge_commit_sha,
					authorLogin: pr.user?.login,
					prUrl: pr.html_url,
				},
			})
			.onConflictDoNothing({ target: claim.bountyId })
			.returning({ id: claim.id });
		// A second merged PR can race the first one. The unique bounty index
		// makes the first attestation canonical; never overwrite its digest or
		// recipient with a later competing submission.
		if (!inserted) return;
		await tx
			.update(bounty)
			.set({
				claimantWallet: wallet.walletAddress,
				claimDigest: digest,
				updatedAt: new Date(),
			})
			.where(eq(bounty.id, bountyRow.id));
	});
}

async function reconcileGitHubClaims() {
	const fundedBounties = await db
		.select({
			bounty,
			installationId: githubInstallation.installationId,
		})
		.from(bounty)
		.innerJoin(repository, eq(repository.fullName, bounty.repository))
		.innerJoin(
			githubInstallation,
			eq(githubInstallation.id, repository.installationId),
		)
		.where(eq(bounty.status, "Funded"));

	for (const row of fundedBounties) {
		if (row.bounty.chainId === SOLANA_DEVNET_ID) {
			if (
				!configuredSolanaDevnetConfig?.programId ||
				(row.bounty.escrowAddress &&
					row.bounty.escrowAddress !== configuredSolanaDevnetConfig.programId)
			)
				continue;
		} else {
			const runtime = getChainRuntime(row.bounty.chainId);
			if (
				row.bounty.escrowAddress &&
				row.bounty.escrowAddress.toLowerCase() !==
					runtime.config.escrowAddress.toLowerCase()
			)
				continue;
		}
		if (row.bounty.onchainBountyId === null) continue;
		const pullRequests = await listRepositoryPullRequests(
			row.installationId,
			row.bounty.repository,
		);
		const marker = new RegExp(
			`\\[PasinPay\\s+#${row.bounty.issueNumber}\\]`,
			"i",
		);
		const participants =
			row.bounty.joiningPasswordSalt || row.bounty.joiningPasswordHash
				? await db
						.select({ githubAccountId: bountyParticipant.githubAccountId })
						.from(bountyParticipant)
						.where(eq(bountyParticipant.bountyId, row.bounty.id))
				: null;
		const mergedPullRequest = pullRequests.find(
			(pullRequest) =>
				pullRequest.state === "closed" &&
				Boolean(pullRequest.merged_at) &&
				Boolean(pullRequest.merge_commit_sha) &&
				marker.test(pullRequest.title) &&
				(!participants ||
					participants.some(
						(participant) =>
							participant.githubAccountId === String(pullRequest.user?.id),
					)),
		);
		if (!mergedPullRequest?.user) continue;

		const installationId = Number(row.installationId);
		if (!Number.isSafeInteger(installationId)) {
			throw new Error(
				`Invalid GitHub installation id for ${row.bounty.repository}`,
			);
		}
		await processGitHubJob({
			id: `reconcile-${row.bounty.id}-${mergedPullRequest.number}`,
			kind: "github.pull_request.closed",
			payload: {
				deliveryId: `reconcile:${mergedPullRequest.number}:${mergedPullRequest.merge_commit_sha}`,
				event: "pull_request",
				payload: {
					installation: { id: installationId },
					repository: { full_name: row.bounty.repository },
					pull_request: {
						merged: true,
						merged_at: mergedPullRequest.merged_at,
						merge_commit_sha: mergedPullRequest.merge_commit_sha,
						number: mergedPullRequest.number,
						title: mergedPullRequest.title,
						html_url: mergedPullRequest.html_url,
						user: mergedPullRequest.user,
					},
				},
			},
			// Reconciliation jobs are synthetic and do not need persisted retry
			// metadata; processGitHubJob only consumes their payload.
			attempts: 1,
			availableAt: new Date(),
			lockedAt: new Date(),
			lastError: null,
			status: "running",
			createdAt: new Date(),
		} as typeof jobTable.$inferSelect);
	}
}

async function processJob(job: typeof jobTable.$inferSelect) {
	if (job.kind === "github.pull_request.closed") return processGitHubJob(job);
	if (job.kind === "chain.sync") return;
}

export async function runWorker() {
	let lastSync = 0;
	let lastGitHubReconciliation = 0;
	for (;;) {
		if (Date.now() - lastSync > 10_000) {
			lastSync = Date.now();
			for (const runtime of Object.values(configuredChainRuntimes)) {
				if (!runtime) continue;
				try {
					await syncChainEvents(runtime);
				} catch (error) {
					console.error(
						`chain reconciliation failed for ${runtime.config.name}`,
						error,
					);
				}
			}
			try {
				await syncSolanaBounties();
			} catch (error) {
				console.error("Solana Devnet reconciliation failed", error);
			}
		}
		if (Date.now() - lastGitHubReconciliation > 30_000) {
			lastGitHubReconciliation = Date.now();
			try {
				await reconcileGitHubClaims();
			} catch (error) {
				console.error("github reconciliation failed", error);
			}
		}
		const staleLock = new Date(Date.now() - 5 * 60_000);
		await db
			.update(jobTable)
			.set({ status: "pending", lockedAt: null })
			.where(
				and(eq(jobTable.status, "running"), lt(jobTable.lockedAt, staleLock)),
			);
		const [next] = await db
			.select()
			.from(jobTable)
			.where(
				and(
					eq(jobTable.status, "pending"),
					lt(jobTable.availableAt, new Date()),
					isNull(jobTable.lockedAt),
				),
			)
			.limit(1);
		if (!next) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			continue;
		}
		const [claimed] = await db
			.update(jobTable)
			.set({
				status: "running",
				lockedAt: new Date(),
				attempts: next.attempts + 1,
			})
			.where(
				and(
					eq(jobTable.id, next.id),
					eq(jobTable.status, "pending"),
					isNull(jobTable.lockedAt),
				),
			)
			.returning();
		if (!claimed) continue;
		try {
			await processJob(claimed);
			await db
				.update(jobTable)
				.set({ status: "completed", lockedAt: null })
				.where(eq(jobTable.id, claimed.id));
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "Unknown worker error";
			await db
				.update(jobTable)
				.set({
					status: claimed.attempts >= 4 ? "failed" : "pending",
					lockedAt: null,
					lastError: message,
					availableAt: new Date(
						Date.now() + Math.min(60_000, 2 ** claimed.attempts * 1000),
					),
				})
				.where(eq(jobTable.id, claimed.id));
		}
	}
}

if (import.meta.main) await runWorker();
