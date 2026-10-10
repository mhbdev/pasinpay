import { apiKeyCredential } from "@pasinpay/db/schema/index";
import { and, desc, eq, isNull } from "drizzle-orm";
import { bytesToHex, keccak256, toBytes } from "viem";
import { z } from "zod";
import { protectedProcedure, router } from "../index";

const apiKeyName = z.string().trim().min(1).max(80);
const expiryDays = z.union([z.literal(30), z.literal(90), z.literal(365)]);

function createSecret() {
	const bytes = new Uint8Array(32);
	globalThis.crypto.getRandomValues(bytes);
	return `pp_live_${bytesToHex(bytes).slice(2)}`;
}

function hashSecret(secret: string) {
	return keccak256(toBytes(secret));
}

export const apiKeyRouter = router({
	list: protectedProcedure.query(async ({ ctx }) =>
		ctx.db
			.select({
				id: apiKeyCredential.id,
				name: apiKeyCredential.name,
				keyPrefix: apiKeyCredential.keyPrefix,
				scopes: apiKeyCredential.scopes,
				createdAt: apiKeyCredential.createdAt,
				lastUsedAt: apiKeyCredential.lastUsedAt,
				expiresAt: apiKeyCredential.expiresAt,
				revokedAt: apiKeyCredential.revokedAt,
			})
			.from(apiKeyCredential)
			.where(eq(apiKeyCredential.userId, ctx.session.user.id))
			.orderBy(desc(apiKeyCredential.createdAt)),
	),

	create: protectedProcedure
		.input(
			z.object({
				name: apiKeyName,
				expiresInDays: expiryDays.default(90),
				allowDrafts: z.boolean().default(false),
			}),
		)
		.mutation(async ({ ctx, input }) => {
			const secret = createSecret();
			const now = new Date();
			const expiresAt = new Date(now);
			expiresAt.setUTCDate(expiresAt.getUTCDate() + input.expiresInDays);
			const scopes = input.allowDrafts
				? ["bounties:read", "bounties:write"]
				: ["bounties:read"];
			const [created] = await ctx.db
				.insert(apiKeyCredential)
				.values({
					id: crypto.randomUUID(),
					userId: ctx.session.user.id,
					name: input.name,
					keyPrefix: secret.slice(0, 16),
					keyHash: hashSecret(secret),
					scopes,
					expiresAt,
				})
				.returning({
					id: apiKeyCredential.id,
					name: apiKeyCredential.name,
					keyPrefix: apiKeyCredential.keyPrefix,
					scopes: apiKeyCredential.scopes,
					expiresAt: apiKeyCredential.expiresAt,
				});
			if (!created) throw new Error("Could not create API key");
			return { ...created, key: secret };
		}),

	revoke: protectedProcedure
		.input(z.object({ id: z.string().min(1) }))
		.mutation(async ({ ctx, input }) => {
			const [revoked] = await ctx.db
				.update(apiKeyCredential)
				.set({ revokedAt: new Date() })
				.where(
					and(
						eq(apiKeyCredential.id, input.id),
						eq(apiKeyCredential.userId, ctx.session.user.id),
						isNull(apiKeyCredential.revokedAt),
					),
				)
				.returning({ id: apiKeyCredential.id });
			if (!revoked) throw new Error("API key not found or already revoked");
			return { ok: true };
		}),
});
