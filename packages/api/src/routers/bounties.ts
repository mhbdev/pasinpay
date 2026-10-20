import { randomBytes } from "node:crypto";
import { chainConfigs, SUPPORTED_CHAIN_IDS } from "@pasinpay/chain";
import {
	account,
	bounty,
	bountyJoinAttempt,
	bountyParticipant,
	claim,
	githubInstallation,
	repository,
	settlement,
	user,
	walletLink,
	walletLinkChallenge,
} from "@pasinpay/db/schema/index";
import {
	isValidSolanaAddress,
	SOLANA_DEVNET_ID,
	verifySolanaRawMessage,
} from "@pasinpay/solana";
import { TRPCError } from "@trpc/server";
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
import {
	createBountyAccessToken,
	hashJoiningPassword,
	verifyBountyAccessToken,
	verifyJoiningPassword,
} from "../lib/private-bounty";
import { getPullRequestStatus } from "../lib/pull-request-status";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const walletAddressSchema = z.string().min(32).max(64);
const chainIdSchema = z
	.number()
	.int()
	.refine(
		(id) =>
			id === SOLANA_DEVNET_ID ||
			(SUPPORTED_CHAIN_IDS as readonly number[]).includes(id),
	);

function configuredChain(ctx: Context, chainId: number) {
	const config = ctx.chains[chainId];
	if (!config) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "This network is not enabled for PasinPay yet.",
		});
	}
	return config;
}

function configuredSolana(ctx: Context) {
	if (!ctx.solana?.programId || !ctx.solana.feeTreasury) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "Solana Devnet escrow is not deployed and configured yet.",
		});
	}
	return ctx.solana;
}

function bountyNetwork(ctx: Context, chainId: number) {
	if (chainId === SOLANA_DEVNET_ID) return configuredSolana(ctx);
	return configuredChain(ctx, chainId);
}

function serializeBounty(row: typeof bounty.$inferSelect) {
	const { joiningPasswordSalt, joiningPasswordHash, ...safeRow } = row;
	return {
		...safeRow,
		isPrivate: Boolean(joiningPasswordSalt || joiningPasswordHash),
		tokenSymbol:
			row.chainId === SOLANA_DEVNET_ID
				? "USDC"
				: (chainConfigs[row.chainId as keyof typeof chainConfigs]
						?.tokenSymbol ?? "USDG"),
		amount: row.amount.toString(),
		feeAmount: row.feeAmount.toString(),
		totalFunded: row.totalFunded.toString(),
		onchainBountyId: row.onchainBountyId?.toString() ?? null,
	};
}

function hasBountyAccess(
	ctx: Context,
	row: typeof bounty.$inferSelect,
	accessToken: string | undefined,
) {
	if (!row.joiningPasswordSalt && !row.joiningPasswordHash) return true;
	if (!row.joiningPasswordSalt || !row.joiningPasswordHash) return false;
	if (ctx.session?.user.id === row.userId) return true;
	if (!ctx.session) return false;
	return verifyBountyAccessToken(
		accessToken,
		ctx.accessTokenSecret,
		ctx.session.user.id,
		row.id,
	);
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
	solanaDevnetConfig: publicProcedure.query(({ ctx }) => ctx.solana ?? null),

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
							eq(bounty.status, "Disputed"),
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

	repositoryPrivacy: protectedProcedure
		.input(z.object({ repository: z.string().min(3).max(200) }))
		.mutation(async ({ ctx, input }) => {
			const installation = await authorizedInstallation(ctx, input.repository);
			return {
				isPrivate: await ctx.github.getRepositoryPrivacy(
					installation.installationId,
					installation.repository,
				),
			};
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
						and(
							isNull(bounty.joiningPasswordSalt),
							isNull(bounty.joiningPasswordHash),
							or(
								ilike(bounty.repository, query),
								ilike(bounty.issueTitle, query),
							),
						),
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
					.select({
						bounty,
						creatorName: user.name,
						creatorImage: user.image,
					})
					.from(bounty)
					.leftJoin(user, eq(user.id, bounty.userId))
					.where(where)
					.orderBy(orderBy)
					.limit(input.pageSize)
					.offset(offset),
				ctx.db
					.selectDistinct({ repository: bounty.repository })
					.from(bounty)
					.where(
						and(
							isNull(bounty.joiningPasswordHash),
							isNull(bounty.joiningPasswordSalt),
						),
					)
					.orderBy(asc(bounty.repository)),
			]);
			const total = Number(countRow[0]?.total ?? 0);

			return {
				items: rows.map((row) => {
					const isPrivate = Boolean(
						row.bounty.joiningPasswordSalt || row.bounty.joiningPasswordHash,
					);
					if (isPrivate)
						return {
							id: row.bounty.id,
							title: row.bounty.title,
							amount: row.bounty.amount.toString(),
							chainId: row.bounty.chainId,
							tokenSymbol:
								row.bounty.chainId === SOLANA_DEVNET_ID
									? "USDC"
									: (chainConfigs[
											row.bounty.chainId as keyof typeof chainConfigs
										]?.tokenSymbol ?? "USDG"),
							isPrivate: true as const,
						};
					return {
						...serializeBounty(row.bounty),
						isPrivate: false as const,
						creator: {
							name: row.creatorName ?? "PasinPay creator",
							image: row.creatorImage ?? null,
						},
					};
				}),
				total,
				page: input.page,
				pageSize: input.pageSize,
				totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
				repositories: repositoryRows.map((row) => row.repository),
			};
		}),

	join: protectedProcedure
		.input(
			z.object({
				bountyId: z.string().uuid(),
				password: z.string().min(1).max(128),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select()
				.from(bounty)
				.where(eq(bounty.id, input.bountyId))
				.limit(1);
			if (!row) throw new TRPCError({ code: "NOT_FOUND" });
			if (!row.joiningPasswordSalt || !row.joiningPasswordHash)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "This bounty does not require a joining password.",
				});

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
			if (!githubAccount)
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Link a GitHub account before joining this bounty.",
				});

			const windowStart = new Date(Date.now() - 15 * 60_000);
			const [attempts] = await ctx.db
				.select({ total: count() })
				.from(bountyJoinAttempt)
				.where(
					and(
						eq(bountyJoinAttempt.bountyId, row.id),
						eq(bountyJoinAttempt.userId, ctx.session.user.id),
						gt(bountyJoinAttempt.failedAt, windowStart),
					),
				);
			if (Number(attempts?.total ?? 0) >= 5)
				throw new TRPCError({
					code: "TOO_MANY_REQUESTS",
					message: "Too many incorrect passwords. Try again in 15 minutes.",
				});
			const valid = await verifyJoiningPassword(
				input.password,
				row.joiningPasswordSalt,
				row.joiningPasswordHash,
			);
			if (!valid) {
				await ctx.db.insert(bountyJoinAttempt).values({
					bountyId: row.id,
					userId: ctx.session.user.id,
				});
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "The joining password is incorrect.",
				});
			}

			await ctx.db
				.insert(bountyParticipant)
				.values({
					bountyId: row.id,
					userId: ctx.session.user.id,
					githubAccountId: githubAccount.accountId,
				})
				.onConflictDoUpdate({
					target: [bountyParticipant.bountyId, bountyParticipant.userId],
					set: {
						githubAccountId: githubAccount.accountId,
						joinedAt: new Date(),
					},
				});
			await ctx.db
				.delete(bountyJoinAttempt)
				.where(
					and(
						eq(bountyJoinAttempt.bountyId, row.id),
						eq(bountyJoinAttempt.userId, ctx.session.user.id),
					),
				);
			return {
				accessToken: createBountyAccessToken(
					ctx.accessTokenSecret,
					ctx.session.user.id,
					row.id,
				),
				expiresInSeconds: 15 * 60,
			};
		}),

	getById: publicProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				accessToken: z.string().max(2_000).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const [row] = await ctx.db
				.select()
				.from(bounty)
				.where(eq(bounty.id, input.id))
				.limit(1);
			if (!row) return null;
			if (!hasBountyAccess(ctx, row, input.accessToken))
				return {
					isLocked: true as const,
					isPrivate: true as const,
					id: row.id,
					title: row.title,
					amount: row.amount.toString(),
					chainId: row.chainId,
					tokenSymbol:
						chainConfigs[row.chainId as keyof typeof chainConfigs]
							?.tokenSymbol ?? "USDG",
				};
			const bountyChain =
				row.chainId === SOLANA_DEVNET_ID
					? ctx.solana
					: (ctx.chains[row.chainId] ??
						chainConfigs[row.chainId as keyof typeof chainConfigs]);
			if (!bountyChain) return null;
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
				status: "Open" | "Closed" | "Merged" | "Verified" | "Superseded";
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
							status: getPullRequestStatus({
								hasCanonicalClaim: claimRows.length > 0,
								hasClaimForPullRequest: claimByPrNumber.has(item.number),
								mergedAt: item.merged_at,
								state: item.state,
							}),
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
				isLocked: false as const,
				creator: {
					name: creatorRow?.name ?? "PasinPay creator",
					image: creatorRow?.image ?? null,
					githubLogin: repositoryInstallation?.accountLogin ?? null,
					githubUrl: repositoryInstallation?.accountLogin
						? `https://github.com/${repositoryInstallation.accountLogin}`
						: null,
					wallet: row.creatorWallet,
				},
				chain: {
					id: row.chainId,
					name: bountyChain.name,
					escrowAddress: row.escrowAddress ?? bountyChain.escrowAddress,
					tokenAddress: bountyChain.tokenAddress,
					tokenSymbol: bountyChain.tokenSymbol,
					feeTreasury: bountyChain.feeTreasury,
					feeBps: bountyChain.feeBps,
					explorerUrl: bountyChain.explorerUrl,
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
		.input(
			z.object({
				bountyId: z.string().uuid(),
				accessToken: z.string().max(2_000).optional(),
			}),
		)
		.query(async ({ ctx, input }) => {
			const [bountyRow] = await ctx.db
				.select()
				.from(bounty)
				.where(eq(bounty.id, input.bountyId))
				.limit(1);
			if (!bountyRow) return null;
			if (!hasBountyAccess(ctx, bountyRow, input.accessToken))
				throw new TRPCError({
					code: "FORBIDDEN",
					message: "Join this private bounty to view claim details.",
				});
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
		const rows = await ctx.db
			.select({
				walletAddress: walletLink.walletAddress,
				chainId: walletLink.chainId,
			})
			.from(walletLink)
			.where(eq(walletLink.userId, ctx.session.user.id));
		return rows;
	}),

	register: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid().optional(),
				onchainBountyId: z.string().regex(/^\d+$/),
				creatorWallet: walletAddressSchema,
				repository: z.string().min(3).max(200),
				repositoryHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
				issueNumber: z.number().int().positive(),
				issueTitle: z.string().min(1).max(300),
				issueUrl: z.string().url(),
				creationMode: z.enum(["existing", "new"]),
				chainId: chainIdSchema,
				title: z.string().min(1).max(200),
				amount: z.string().regex(/^\d+$/),
				feeAmount: z.string().regex(/^\d+$/),
				totalFunded: z.string().regex(/^\d+$/),
				deadline: z.coerce.date(),
				joiningPassword: z.string().min(12).max(128).optional(),
				reviewWindowSeconds: z
					.number()
					.int()
					.positive()
					.max(30 * 24 * 60 * 60),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const targetChain = bountyNetwork(ctx, input.chainId);
			const [linkedWallet] = await ctx.db
				.select()
				.from(walletLink)
				.where(
					and(
						eq(walletLink.userId, ctx.session.user.id),
						eq(walletLink.chainId, targetChain.id),
					),
				)
				.limit(1);
			const creatorWallet =
				input.chainId === SOLANA_DEVNET_ID
					? isValidSolanaAddress(input.creatorWallet)
						? input.creatorWallet
						: null
					: addressSchema.safeParse(input.creatorWallet).success
						? getAddress(input.creatorWallet)
						: null;
			if (
				!linkedWallet ||
				linkedWallet.chainId !== targetChain.id ||
				!creatorWallet ||
				linkedWallet.walletAddress !== creatorWallet
			)
				throw new Error("Link this wallet before creating a bounty");
			const [authorizedRepository] = await ctx.db
				.select({
					id: repository.id,
					installationId: githubInstallation.installationId,
				})
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
			if (
				input.joiningPassword &&
				!(await ctx.github.getRepositoryPrivacy(
					authorizedRepository.installationId,
					input.repository,
				))
			)
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Password protected bounties require a private GitHub repository.",
				});
			const rewardAmount = BigInt(input.amount);
			const feeAmount = BigInt(input.feeAmount);
			const totalFunded = BigInt(input.totalFunded);
			const passwordHash = input.joiningPassword
				? await hashJoiningPassword(input.joiningPassword)
				: null;
			const expectedFee =
				(rewardAmount * BigInt(targetChain.feeBps)) / BigInt(10_000);
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
					escrowAddress: targetChain.escrowAddress,
					onchainBountyId: BigInt(input.onchainBountyId),
					creatorWallet,
					repository: input.repository,
					repositoryHash: input.repositoryHash.toLowerCase(),
					issueNumber: input.issueNumber,
					issueTitle: input.issueTitle,
					issueUrl: input.issueUrl,
					creationMode: input.creationMode,
					joiningPasswordSalt: passwordHash?.salt ?? null,
					joiningPasswordHash: passwordHash?.hash ?? null,
					title: input.title,
					amount: rewardAmount,
					feeAmount,
					totalFunded,
					deadline: input.deadline,
					reviewWindowSeconds: input.reviewWindowSeconds,
					status: "Open",
				})
				.onConflictDoUpdate({
					target: [
						bounty.chainId,
						bounty.escrowAddress,
						bounty.onchainBountyId,
					],
					set: {
						amount: rewardAmount,
						feeAmount,
						totalFunded,
						escrowAddress: targetChain.escrowAddress,
						status: "Open",
						joiningPasswordSalt: passwordHash?.salt ?? null,
						joiningPasswordHash: passwordHash?.hash ?? null,
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
				chainId: chainIdSchema,
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
			if (input.chainId === SOLANA_DEVNET_ID) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"Solana bounty status is indexed from confirmed on-chain accounts; client-provided status updates are not accepted.",
				});
			}
			const targetChain = bountyNetwork(ctx, input.chainId);
			const [row] = await ctx.db
				.update(bounty)
				.set({ status: input.status, updatedAt: new Date() })
				.where(
					and(
						eq(bounty.userId, ctx.session.user.id),
						eq(bounty.chainId, targetChain.id),
						eq(bounty.escrowAddress, targetChain.escrowAddress),
						eq(bounty.onchainBountyId, BigInt(input.onchainBountyId)),
					),
				)
				.returning();
			return row ? serializeBounty(row) : null;
		}),

	walletChallenge: protectedProcedure
		.input(
			z.object({
				address: walletAddressSchema,
				chainId: chainIdSchema,
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.chainId === SOLANA_DEVNET_ID) {
				configuredSolana(ctx);
				if (!isValidSolanaAddress(input.address)) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Enter a valid Solana wallet address.",
					});
				}
			} else {
				configuredChain(ctx, input.chainId);
				if (!addressSchema.safeParse(input.address).success) {
					throw new TRPCError({
						code: "BAD_REQUEST",
						message: "Enter a valid EVM wallet address.",
					});
				}
			}
			const normalizedAddress =
				input.chainId === SOLANA_DEVNET_ID
					? input.address
					: getAddress(input.address);
			const nonce = randomBytes(24).toString("hex");
			const message = [
				"PasinPay wallet linking",
				"",
				`User: ${ctx.session.user.id}`,
				`Wallet: ${normalizedAddress}`,
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
				address: walletAddressSchema,
				chainId: chainIdSchema,
				signature: z.string().min(64).max(132),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			if (input.chainId === SOLANA_DEVNET_ID) configuredSolana(ctx);
			else configuredChain(ctx, input.chainId);
			const normalizedAddress =
				input.chainId === SOLANA_DEVNET_ID
					? input.address
					: addressSchema.safeParse(input.address).success
						? getAddress(input.address)
						: "";
			if (
				input.chainId === SOLANA_DEVNET_ID &&
				!isValidSolanaAddress(input.address)
			) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Enter a valid Solana wallet address.",
				});
			}
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
				!(input.chainId === SOLANA_DEVNET_ID
					? await verifySolanaRawMessage({
							address: input.address,
							message: challenge.message,
							signature: input.signature,
						})
					: addressSchema.safeParse(input.address).success &&
						(await verifyMessage({
							address: getAddress(input.address),
							message: challenge.message,
							signature: input.signature as `0x${string}`,
						})))
			) {
				throw new Error("Wallet signature could not be verified");
			}
			const [existingOwner] = await ctx.db
				.select({ userId: walletLink.userId })
				.from(walletLink)
				.where(
					and(
						eq(walletLink.chainId, input.chainId),
						eq(walletLink.walletAddress, normalizedAddress),
					),
				)
				.limit(1);
			if (existingOwner && existingOwner.userId !== ctx.session.user.id)
				throw new Error("This wallet is already linked to another account");
			const link = await ctx.db.transaction(async (tx) => {
				const [consumedChallenge] = await tx
					.update(walletLinkChallenge)
					.set({ usedAt: new Date() })
					.where(
						and(
							eq(walletLinkChallenge.id, challenge.id),
							isNull(walletLinkChallenge.usedAt),
							gt(walletLinkChallenge.expiresAt, new Date()),
						),
					)
					.returning({ id: walletLinkChallenge.id });
				if (!consumedChallenge)
					throw new Error("Wallet challenge has already been used or expired");
				const [updatedLink] = await tx
					.insert(walletLink)
					.values({
						userId: ctx.session.user.id,
						walletAddress: normalizedAddress,
						chainId: input.chainId,
					})
					.onConflictDoUpdate({
						target: [walletLink.userId, walletLink.chainId],
						set: { walletAddress: normalizedAddress, createdAt: new Date() },
					})
					.returning();
				return updatedLink;
			});
			return link;
		}),

	unlinkWallet: protectedProcedure
		.input(z.object({ chainId: chainIdSchema.optional() }).optional())
		.mutation(async ({ ctx, input }) => {
			await ctx.db
				.delete(walletLink)
				.where(
					input?.chainId === undefined
						? eq(walletLink.userId, ctx.session.user.id)
						: and(
								eq(walletLink.userId, ctx.session.user.id),
								eq(walletLink.chainId, input.chainId),
							),
				);
			return { ok: true };
		}),
});
