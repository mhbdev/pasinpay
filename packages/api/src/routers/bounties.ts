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

import { protectedProcedure, publicProcedure, router } from "../index";

const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);

function serializeBounty(row: typeof bounty.$inferSelect) {
	return {
		...row,
		amount: row.amount.toString(),
		onchainBountyId: row.onchainBountyId?.toString() ?? null,
	};
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
			return {
				...serializeBounty(row),
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

	register: protectedProcedure
		.input(
			z.object({
				id: z.string().uuid().optional(),
				onchainBountyId: z.string().regex(/^\d+$/),
				creatorWallet: addressSchema,
				repository: z.string().min(3).max(200),
				repositoryHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
				issueNumber: z.number().int().positive(),
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
					onchainBountyId: BigInt(input.onchainBountyId),
					creatorWallet: getAddress(input.creatorWallet),
					repository: input.repository,
					repositoryHash: input.repositoryHash.toLowerCase(),
					issueNumber: input.issueNumber,
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
});
