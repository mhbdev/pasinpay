import { randomBytes } from "node:crypto";
import {
	account,
	bounty,
	claim,
	githubInstallation,
	repository,
	settlement,
	user,
	walletLink,
	walletLinkChallenge,
} from "@pasinpay/db/schema/index";
import {
	and,
	asc,
	count,
	desc,
	eq,
	gt,
	ilike,
	isNull,
	or,
	sql,
} from "drizzle-orm";
import { getAddress, keccak256, toBytes, verifyMessage } from "viem";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, publicProcedure, router } from "../index";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

function serializeBounty(row: typeof bounty.$inferSelect) {
	return {
		...row,
		amount: row.amount.toString(),
		feeAmount: row.feeAmount.toString(),
		totalFunded: row.totalFunded.toString(),
		onchainBountyId: row.onchainBountyId?.toString() ?? null,
	};
}

async function authorizedInstallation(
	ctx: Context & { session: NonNullable<Context["session"]> },
	repositoryName: string,
) {
	const [row] = await ctx.db
		.select({
			installationId: githubInstallation.installationId,
			repository: repository.fullName,
		})
		.from(repository)
		.innerJoin(
			githubInstallation,
			eq(repository.installationId, githubInstallation.id),
		)
		.where(
			and(
				eq(githubInstallation.userId, ctx.session.user.id),
				sql`lower(${repository.fullName}) = lower(${repositoryName})`,
			),
		)
		.limit(1);
	if (!row)
		throw new Error("Select a repository installed through the GitHub App");
	return row;
}

export const bountyRouter = router({
	platformStats: publicProcedure.query(async ({ ctx }) => {
		const [usersRow, bountiesRow, paidRow, fundedRow, rewardRow] =
			await Promise.all([
				ctx.db.select({ total: count() }).from(user),
				ctx.db.select({ total: count() }).from(bounty),
				ctx.db
					.select({ total: count() })
					.from(bounty)
					.where(eq(bounty.status, "Paid")),
				ctx.db
					.select({ total: count() })
					.from(bounty)
					.where(
						or(
							eq(bounty.status, "Funded"),
							eq(bounty.status, "ClaimPending"),
							eq(bounty.status, "Paid"),
						),
					),
				ctx.db
					.select({ total: sql<string>`coalesce(sum(${bounty.amount}), 0)` })
					.from(bounty)
					.where(eq(bounty.status, "Paid")),
			]);

		return {
			users: Number(usersRow[0]?.total ?? 0),
			bounties: Number(bountiesRow[0]?.total ?? 0),
			resolvedBounties: Number(paidRow[0]?.total ?? 0),
			activeBounties: Number(fundedRow[0]?.total ?? 0),
			resolvedReward: String(rewardRow[0]?.total ?? "0"),
		};
	}),

	repositories: protectedProcedure.query(async ({ ctx }) => {
		return ctx.db
			.select({
				id: repository.id,
				fullName: repository.fullName,
				repositoryHash: repository.repositoryHash,
				htmlUrl: repository.htmlUrl,
			})
			.from(repository)
			.innerJoin(
				githubInstallation,
				eq(repository.installationId, githubInstallation.id),
			)
			.where(eq(githubInstallation.userId, ctx.session.user.id));
	}),

	issues: protectedProcedure
		.input(
			z.object({
				repository: z.string().min(3).max(200),
				search: z.string().max(100).default(""),
			}),
		)
		.query(async ({ ctx, input }) => {
			const installation = await authorizedInstallation(ctx, input.repository);
			return ctx.github.listRepositoryIssues(
				installation.installationId,
				installation.repository,
				input.search,
			);
		}),

	createIssue: protectedProcedure
		.input(
			z.object({
				repository: z.string().min(3).max(200),
				title: z.string().trim().min(4).max(200),
				body: z.string().max(20_000).default(""),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const installation = await authorizedInstallation(ctx, input.repository);
			return ctx.github.createIssue(
				installation.installationId,
				installation.repository,
				{
					title: input.title,
					body: input.body,
				},
			);
		}),

	linkGitHubIssue: protectedProcedure
		.input(
			z.object({
				repository: z.string().min(3).max(200),
				issueNumber: z.number().int().positive(),
				title: z.string().trim().min(4).max(200),
				bountyUrl: z.string().url(),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const installation = await authorizedInstallation(ctx, input.repository);
			const issues = await ctx.github.listRepositoryIssues(
				installation.installationId,
				installation.repository,
				String(input.issueNumber),
			);
			const issue = issues.find((item) => item.number === input.issueNumber);
			if (!issue)
				throw new Error("GitHub issue could not be found or is not open");
			const link = `\n\n---\n**Funded by PasinPay:** ${input.bountyUrl}`;
			const body = `${issue.body ?? ""}${(issue.body ?? "").includes(input.bountyUrl) ? "" : link}`;
			return ctx.github.linkIssue(
				installation.installationId,
				installation.repository,
				input.issueNumber,
				{ title: input.title, body },
			);
		}),

	githubApp: protectedProcedure.query(({ ctx }) => ({
		installUrl: ctx.github.appSlug
			? `https://github.com/apps/${ctx.github.appSlug}/installations/new`
			: null,
	})),

	githubStatus: protectedProcedure.query(async ({ ctx }) => {
		const [linkedAccount] = await ctx.db
			.select({ id: account.id })
			.from(account)
			.where(
				and(
					eq(account.userId, ctx.session.user.id),
					eq(account.providerId, "github"),
				),
			)
			.limit(1);
		return { connected: Boolean(linkedAccount) };
	}),

	refreshRepositories: protectedProcedure.mutation(async ({ ctx }) => {
		const existingInstallations = await ctx.db
			.select()
			.from(githubInstallation)
			.where(eq(githubInstallation.userId, ctx.session.user.id));
		const [githubAccount] = await ctx.db
			.select({ accountId: account.accountId })
			.from(account)
			.where(
				and(
					eq(account.userId, ctx.session.user.id),
					eq(account.providerId, "github"),
				),
			)
			.limit(1);
		if (!githubAccount) {
			throw new Error("Connect GitHub before syncing repositories");
		}

		const appInstallations = await ctx.github.listAppInstallations();
		const matchedAppInstallations = appInstallations.filter(
			(installation) =>
				String(installation.account.id) === githubAccount.accountId,
		);
		if (!matchedAppInstallations.length && !existingInstallations.length) {
			throw new Error(
				"Install the PasinPay GitHub App before syncing repositories",
			);
		}

		const installations = existingInstallations.slice();
		for (const remoteInstallation of matchedAppInstallations) {
			const [installation] = await ctx.db
				.insert(githubInstallation)
				.values({
					installationId: String(remoteInstallation.id),
					accountLogin: remoteInstallation.account.login,
					accountType: remoteInstallation.account.type,
					userId: ctx.session.user.id,
				})
				.onConflictDoUpdate({
					target: githubInstallation.installationId,
					set: {
						accountLogin: remoteInstallation.account.login,
						accountType: remoteInstallation.account.type,
						userId: ctx.session.user.id,
						updatedAt: new Date(),
					},
				})
				.returning();
			if (
				installation &&
				!installations.some((item) => item.id === installation.id)
			) {
				installations.push(installation);
			}
		}

		let synced = 0;
		for (const installation of installations) {
			const remoteRepositories = await ctx.github.listInstallationRepositories(
				installation.installationId,
			);
			for (const remote of remoteRepositories) {
				const fullName = remote.full_name.trim();
				if (!fullName || !remote.html_url) continue;
				await ctx.db
					.insert(repository)
					.values({
						installationId: installation.id,
						fullName,
						repositoryHash: keccak256(toBytes(fullName.toLowerCase())),
						htmlUrl: remote.html_url,
					})
					.onConflictDoUpdate({
						target: [repository.installationId, repository.fullName],
						set: {
							repositoryHash: keccak256(toBytes(fullName.toLowerCase())),
							htmlUrl: remote.html_url,
						},
					});
				synced += 1;
			}
		}
		return { synced };
	}),

	list: publicProcedure
		.input(
			z.object({
				search: z.string().trim().max(100).default(""),
				status: z
					.enum([
						"all",
						"Open",
						"Funded",
						"ClaimPending",
						"Paid",
						"Disputed",
						"Refunded",
						"Cancelled",
					])
					.default("all"),
				repository: z.string().trim().max(200).default(""),
				sort: z
					.enum(["newest", "oldest", "reward_high", "reward_low"])
					.default("newest"),
				page: z.number().int().positive().default(1),
				pageSize: z.number().int().min(6).max(24).default(12),
			}),
		)
		.query(async ({ ctx, input }) => {
			const filters = [];
			if (input.search) {
				const query = `%${input.search}%`;
				filters.push(
					or(
						ilike(bounty.title, query),
						ilike(bounty.repository, query),
						ilike(bounty.issueTitle, query),
					),
				);
			}
			if (input.status !== "all") filters.push(eq(bounty.status, input.status));
			if (input.repository)
				filters.push(eq(bounty.repository, input.repository));

			const where = filters.length ? and(...filters) : undefined;
			const orderBy = {
				newest: desc(bounty.createdAt),
				oldest: asc(bounty.createdAt),
				reward_high: desc(bounty.amount),
				reward_low: asc(bounty.amount),
			}[input.sort];
			const offset = (input.page - 1) * input.pageSize;

			const [countRow, rows, repositoryRows] = await Promise.all([
				ctx.db.select({ total: count() }).from(bounty).where(where),
				ctx.db
					.select()
					.from(bounty)
					.where(where)
					.orderBy(orderBy)
					.limit(input.pageSize)
					.offset(offset),
				ctx.db
					.selectDistinct({ repository: bounty.repository })
					.from(bounty)
					.orderBy(asc(bounty.repository)),
			]);
			const total = Number(countRow[0]?.total ?? 0);

			return {
				items: rows.map(serializeBounty),
				total,
				page: input.page,
				pageSize: input.pageSize,
				totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
				repositories: repositoryRows.map((row) => row.repository),
			};
		}),

	getById: publicProcedure
		.input(z.object({ id: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select()
				.from(bounty)
				.where(eq(bounty.id, input.id))
				.limit(1);
			if (!row) return null;
			const [creatorRow] = await ctx.db
				.select({
					name: user.name,
					image: user.image,
				})
				.from(user)
				.where(eq(user.id, row.userId))
				.limit(1);
			const [settlementRow] = await ctx.db
				.select()
				.from(settlement)
				.where(eq(settlement.bountyId, row.id))
				.limit(1);
			const claimRows = await ctx.db
				.select()
				.from(claim)
				.where(eq(claim.bountyId, row.id))
				.orderBy(desc(claim.createdAt));
			const [repositoryInstallation] = await ctx.db
				.select({
					installationId: githubInstallation.installationId,
					accountLogin: githubInstallation.accountLogin,
				})
				.from(repository)
				.innerJoin(
					githubInstallation,
					eq(repository.installationId, githubInstallation.id),
				)
				.where(sql`lower(${repository.fullName}) = lower(${row.repository})`)
				.limit(1);

			const claimByPrNumber = new Map(
				claimRows.map((item) => [item.githubPrNumber, item]),
			);
			let pullRequests: Array<{
				number: number;
				title: string;
				state: "open" | "closed";
				mergedAt: string | null;
				mergeCommitSha: string | null;
				htmlUrl: string;
				updatedAt: string;
				authorLogin: string | null;
				status: "Open" | "Closed" | "Merged" | "Verified";
			}> = [];
			if (repositoryInstallation) {
				try {
					const issuePullRequests = await ctx.github.listRepositoryPullRequests(
						repositoryInstallation.installationId,
						row.repository,
					);
					const marker = new RegExp(
						`\\[PasinPay\\s+#${row.issueNumber}\\]`,
						"i",
					);
					pullRequests = issuePullRequests
						.filter(
							(item) =>
								marker.test(item.title) || claimByPrNumber.has(item.number),
						)
						.map((item) => ({
							number: item.number,
							title: item.title,
							state: item.state,
							mergedAt: item.merged_at,
							mergeCommitSha: item.merge_commit_sha,
							htmlUrl: item.html_url,
							updatedAt: item.updated_at,
							authorLogin: item.user?.login ?? null,
							status: claimByPrNumber.has(item.number)
								? "Verified"
								: item.merged_at
									? "Merged"
									: item.state === "closed"
										? "Closed"
										: "Open",
						}));
				} catch {
					// A public bounty page must remain available if GitHub is
					// temporarily unavailable. Claims remain authoritative.
					pullRequests = [];
				}
			}
			const contributorKeys = [
				...pullRequests.map(
					(item) =>
						`github:${item.authorLogin?.toLowerCase() ?? `pr:${item.number}`}`,
				),
				...claimRows.map(
					(item) => `wallet:${item.claimantWallet.toLowerCase()}`,
				),
			];
			const existingParticipantCount = new Set(
				[
					row.creatorWallet,
					...claimRows.map((item) => item.claimantWallet),
				].map((address) => address.toLowerCase()),
			).size;
			return {
				...serializeBounty(row),
				creator: {
					name: creatorRow?.name ?? "PasinPay creator",
					image: creatorRow?.image ?? null,
					githubLogin: repositoryInstallation?.accountLogin ?? null,
					githubUrl: repositoryInstallation?.accountLogin
						? "https://github.com/" + repositoryInstallation.accountLogin
						: null,
					wallet: row.creatorWallet,
				},
				chain: {
					id: row.chainId,
					name: ctx.chain.name,
					escrowAddress: ctx.chain.escrowAddress,
					tokenAddress: ctx.chain.usdgAddress,
					feeTreasury: ctx.chain.feeTreasury,
					feeBps: ctx.chain.feeBps,
					explorerUrl: ctx.chain.explorerUrl,
				},
				stats: {
					participants: contributorKeys.length
						? new Set(contributorKeys).size
						: existingParticipantCount,
					submissions: pullRequests.length,
					linkedPullRequests: pullRequests.length,
				},
				pullRequests,
				claims: claimRows.map((item) => ({
					...item,
					attestationNonce: item.attestationNonce.toString(),
					evidence: item.evidence as Record<string, unknown>,
				})),
				settlement: settlementRow
					? {
							...settlementRow,
							amount: settlementRow.amount.toString(),
							feeAmount: settlementRow.feeAmount.toString(),
						}
					: null,
			};
		}),

	claim: publicProcedure
		.input(z.object({ bountyId: z.string().uuid() }))
		.query(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select()
				.from(claim)
				.where(eq(claim.bountyId, input.bountyId))
				.orderBy(desc(claim.createdAt))
				.limit(1);
			return row
				? {
						...row,
						attestationNonce: row.attestationNonce.toString(),
						evidence: row.evidence as Record<string, unknown>,
					}
				: null;
		}),

	mine: protectedProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select()
			.from(bounty)
			.where(eq(bounty.userId, ctx.session.user.id))
			.orderBy(desc(bounty.createdAt));
		return rows.map(serializeBounty);
	}),

	walletLink: protectedProcedure.query(async ({ ctx }) => {
		const [row] = await ctx.db
			.select({
				walletAddress: walletLink.walletAddress,
				chainId: walletLink.chainId,
			})
			.from(walletLink)
			.where(eq(walletLink.userId, ctx.session.user.id))
			.limit(1);
		return row ?? null;
	}),

	register: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid().optional(),
				onchainBountyId: z.string().regex(/^\d+$/),
				creatorWallet: addressSchema,
				repository: z.string().min(3).max(200),
				repositoryHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
				issueNumber: z.number().int().positive(),
				issueTitle: z.string().min(1).max(300),
				issueUrl: z.string().url(),
				creationMode: z.enum(["existing", "new"]),
				chainId: z.union([z.literal(421614), z.literal(42161)]),
				title: z.string().min(1).max(200),
				amount: z.string().regex(/^\d+$/),
				feeAmount: z.string().regex(/^\d+$/),
				totalFunded: z.string().regex(/^\d+$/),
				deadline: z.coerce.date(),
				reviewWindowSeconds: z
					.number()
					.int()
					.positive()
					.max(30 * 24 * 60 * 60),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.chainId !== ctx.chain.id)
				throw new Error(`This API is configured for ${ctx.chain.name}`);
			const [linkedWallet] = await ctx.db
				.select()
				.from(walletLink)
				.where(eq(walletLink.userId, ctx.session.user.id))
				.limit(1);
			if (
				!linkedWallet ||
				linkedWallet.walletAddress.toLowerCase() !==
					input.creatorWallet.toLowerCase()
			)
				throw new Error("Link this wallet before creating a bounty");
			const [authorizedRepository] = await ctx.db
				.select({ id: repository.id })
				.from(repository)
				.innerJoin(
					githubInstallation,
					eq(repository.installationId, githubInstallation.id),
				)
				.where(
					and(
						eq(githubInstallation.userId, ctx.session.user.id),
						sql`lower(${repository.fullName}) = lower(${input.repository})`,
					),
				)
				.limit(1);
			if (!authorizedRepository)
				throw new Error("Select a repository installed through the GitHub App");
			const rewardAmount = BigInt(input.amount);
			const feeAmount = BigInt(input.feeAmount);
			const totalFunded = BigInt(input.totalFunded);
			const expectedFee =
				(rewardAmount * BigInt(ctx.chain.feeBps)) / BigInt(10_000);
			if (
				feeAmount !== expectedFee ||
				totalFunded !== rewardAmount + feeAmount
			) {
				throw new Error(
					"Funding totals do not match the configured platform fee",
				);
			}
			const [row] = await ctx.db
				.insert(bounty)
				.values({
					id: input.id,
					userId: ctx.session.user.id,
					chainId: input.chainId,
					onchainBountyId: BigInt(input.onchainBountyId),
					creatorWallet: getAddress(input.creatorWallet),
					repository: input.repository,
					repositoryHash: input.repositoryHash.toLowerCase(),
					issueNumber: input.issueNumber,
					issueTitle: input.issueTitle,
					issueUrl: input.issueUrl,
					creationMode: input.creationMode,
					title: input.title,
					amount: rewardAmount,
					feeAmount,
					totalFunded,
					deadline: input.deadline,
					reviewWindowSeconds: input.reviewWindowSeconds,
					status: "Open",
				})
				.onConflictDoUpdate({
					target: bounty.onchainBountyId,
					set: {
						amount: rewardAmount,
						feeAmount,
						totalFunded,
						status: "Open",
						updatedAt: new Date(),
					},
				})
				.returning();
			if (!row) throw new Error("Bounty registration failed");
			return serializeBounty(row);
		}),

	syncStatus: protectedProcedure
		.input(
			z.object({
				onchainBountyId: z.string().regex(/^\d+$/),
				status: z.enum([
					"Open",
					"Funded",
					"ClaimPending",
					"Paid",
					"Disputed",
					"Refunded",
					"Cancelled",
				]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.update(bounty)
				.set({ status: input.status, updatedAt: new Date() })
				.where(
					and(
						eq(bounty.userId, ctx.session.user.id),
						eq(bounty.onchainBountyId, BigInt(input.onchainBountyId)),
					),
				)
				.returning();
			return row ? serializeBounty(row) : null;
		}),

	walletChallenge: protectedProcedure
		.input(
			z.object({
				address: addressSchema,
				chainId: z.union([z.literal(421614), z.literal(42161)]),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const nonce = randomBytes(24).toString("hex");
			const message = [
				"PasinPay wallet linking",
				"",
				`User: ${ctx.session.user.id}`,
				`Wallet: ${getAddress(input.address)}`,
				`Chain ID: ${input.chainId}`,
				`Nonce: ${nonce}`,
				`Expires: ${new Date(Date.now() + 10 * 60_000).toISOString()}`,
			].join("\n");
			await ctx.db.insert(walletLinkChallenge).values({
				userId: ctx.session.user.id,
				nonce,
				message,
				chainId: input.chainId,
				expiresAt: new Date(Date.now() + 10 * 60_000),
			});
			return { message, nonce };
		}),

	linkWallet: protectedProcedure
		.input(
			z.object({
				nonce: z.string(),
				address: addressSchema,
				chainId: z.union([z.literal(421614), z.literal(42161)]),
				signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [challenge] = await ctx.db
				.select()
				.from(walletLinkChallenge)
				.where(
					and(
						eq(walletLinkChallenge.userId, ctx.session.user.id),
						eq(walletLinkChallenge.nonce, input.nonce),
						isNull(walletLinkChallenge.usedAt),
						gt(walletLinkChallenge.expiresAt, new Date()),
					),
				)
				.limit(1);
			if (
				!challenge ||
				challenge.chainId !== input.chainId ||
				!(await verifyMessage({
					address: getAddress(input.address),
					message: challenge.message,
					signature: input.signature as `0x${string}`,
				}))
			) {
				throw new Error("Wallet signature could not be verified");
			}
			const [existingOwner] = await ctx.db
				.select({ userId: walletLink.userId })
				.from(walletLink)
				.where(eq(walletLink.walletAddress, getAddress(input.address)))
				.limit(1);
			if (existingOwner && existingOwner.userId !== ctx.session.user.id)
				throw new Error("This wallet is already linked to another account");
			await ctx.db
				.update(walletLinkChallenge)
				.set({ usedAt: new Date() })
				.where(eq(walletLinkChallenge.id, challenge.id));
			const [link] = await ctx.db
				.insert(walletLink)
				.values({
					userId: ctx.session.user.id,
					walletAddress: getAddress(input.address),
					chainId: input.chainId,
				})
				.onConflictDoUpdate({
					target: walletLink.userId,
					set: {
						walletAddress: getAddress(input.address),
						chainId: input.chainId,
						createdAt: new Date(),
					},
				})
				.returning();
			return link;
		}),

	unlinkWallet: protectedProcedure.mutation(async ({ ctx }) => {
		await ctx.db
			.delete(walletLink)
			.where(eq(walletLink.userId, ctx.session.user.id));
		return { ok: true };
	}),
});
