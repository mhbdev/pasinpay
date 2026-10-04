import { randomBytes } from "node:crypto";
import { claimDigest } from "@pasinpay/chain";
import {
	account,
	bounty,
	chainCursor,
	claim,
	githubInstallation,
	job as jobTable,
	repository,
	settlement,
	walletLink,
} from "@pasinpay/db/schema/index";
import { and, eq, isNull, lt } from "drizzle-orm";
import type { Hex } from "viem";
import { signClaim } from "./lib/attestor";
import {
	createInstallationToken,
	githubRequest,
	listRepositoryPullRequests,
} from "./lib/github";
import { chainConfig, db, publicClient } from "./services";

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

async function syncChainEvents() {
	if (
		chainConfig.escrowAddress === "0x0000000000000000000000000000000000000000"
	)
		return;
	const [cursor] = await db
		.select()
		.from(chainCursor)
		.where(eq(chainCursor.id, "escrow"));
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
		.values({ id: "escrow", chainId: chainConfig.id, lastBlock: latest })
		.onConflictDoUpdate({
			target: chainCursor.id,
			set: { lastBlock: latest, updatedAt: new Date() },
		});
}

function shaToBytes32(sha: string): Hex {
	if (!/^[a-f0-9]{40}$/i.test(sha))
		throw new Error("GitHub did not provide a valid merge commit SHA");
	return `0x${sha.toLowerCase().padStart(64, "0")}` as Hex;
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
				eq(bounty.chainId, chainConfig.id),
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
	const [wallet] = await db
		.select()
		.from(walletLink)
		.where(eq(walletLink.userId, githubAccount.userId))
		.limit(1);
	if (!wallet)
		throw new Error(`GitHub user ${pr.user.login} has no linked wallet`);

	const mergeCommit = shaToBytes32(pr.merge_commit_sha);
	const expiresAt = Math.min(
		Math.floor(bountyRow.deadline.getTime() / 1000) - 30,
		Math.floor(Date.now() / 1000) + 3600,
	);
	if (expiresAt <= Math.floor(Date.now() / 1000))
		throw new Error("No time remains for an attestation");
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
	const { signature } = await signClaim(message);
	const digest = claimDigest(
		chainConfig.id,
		chainConfig.escrowAddress,
		message,
	);

	await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({ id: claim.id })
			.from(claim)
			.where(
				and(
					eq(claim.bountyId, bountyRow.id),
					eq(claim.githubPrNumber, prNumber),
				),
			)
			.limit(1);
		if (existing) return;
		await tx.insert(claim).values({
			bountyId: bountyRow.id,
			githubPrNumber: prNumber,
			mergeCommitSha,
			claimantWallet: wallet.walletAddress,
			attestationDigest: digest,
			attestationSignature: signature,
			attestationNonce: message.nonce,
			attestationExpiresAt: new Date(expiresAt * 1000),
			githubDeliveryId: jobPayload.deliveryId ?? job.id,
			evidence: {
				repository,
				issueNumber: bountyRow.issueNumber,
				prNumber: pr.number,
				commitHash: pr.merge_commit_sha,
				authorLogin: pr.user?.login,
				prUrl: pr.html_url,
			},
		});
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
		.where(
			and(eq(bounty.chainId, chainConfig.id), eq(bounty.status, "Funded")),
		);

	for (const row of fundedBounties) {
		if (row.bounty.onchainBountyId === null) continue;
		const pullRequests = await listRepositoryPullRequests(
			row.installationId,
			row.bounty.repository,
		);
		const marker = new RegExp(
			`\\[PasinPay\\s+#${row.bounty.issueNumber}\\]`,
			"i",
		);
		const mergedPullRequest = pullRequests.find(
			(pullRequest) =>
				pullRequest.state === "closed" &&
				Boolean(pullRequest.merged_at) &&
				Boolean(pullRequest.merge_commit_sha) &&
				marker.test(pullRequest.title),
		);
		if (!mergedPullRequest || !mergedPullRequest.user) continue;

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
			try {
				await syncChainEvents();
			} catch (error) {
				console.error("chain reconciliation failed", error);
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
