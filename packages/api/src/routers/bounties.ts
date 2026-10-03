import { randomBytes } from "node:crypto";
import {
	account,
	bounty,
	claim,
	githubInstallation,
	repository,
	settlement,
	walletLink,
	walletLinkChallenge,
} from "@pasinpay/db/schema/index";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { getAddress, keccak256, toBytes, verifyMessage } from "viem";
import { z } from "zod";

import type { Context } from "../context";
import { protectedProcedure, publicProcedure, router } from "../index";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

function serializeBounty(row: typeof bounty.$inferSelect) {
	return {
		...row,
		amount: row.amount.toString(),
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
		const installations = await ctx.db
			.select()
			.from(githubInstallation)
			.where(eq(githubInstallation.userId, ctx.session.user.id));
		if (!installations.length) {
			throw new Error(
				"Install the PasinPay GitHub App before syncing repositories",
			);
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

	list: publicProcedure.query(async ({ ctx }) => {
		const rows = await ctx.db
			.select()
			.from(bounty)
			.orderBy(desc(bounty.createdAt))
			.limit(50);
		return rows.map(serializeBounty);
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
			return {
				...serializeBounty(row),
				chain: {
					id: row.chainId,
					name: ctx.chain.name,
					escrowAddress: ctx.chain.escrowAddress,
					tokenAddress: ctx.chain.usdgAddress,
					explorerUrl: ctx.chain.explorerUrl,
				},
				stats: {
					participants: new Set(
						[
							row.creatorWallet,
							...claimRows.map((item) => item.claimantWallet),
						].map((address) => address.toLowerCase()),
					).size,
					submissions: claimRows.length,
					linkedPullRequests: claimRows.length,
				},
				claims: claimRows.map((item) => ({
					...item,
					attestationNonce: item.attestationNonce.toString(),
					evidence: item.evidence as Record<string, unknown>,
				})),
				settlement: settlementRow
					? { ...settlementRow, amount: settlementRow.amount.toString() }
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
					amount: BigInt(input.amount),
					deadline: input.deadline,
					reviewWindowSeconds: input.reviewWindowSeconds,
					status: "Open",
				})
				.onConflictDoUpdate({
					target: bounty.onchainBountyId,
					set: {
						amount: BigInt(input.amount),
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
