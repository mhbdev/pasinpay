import {
	account,
	githubInstallation,
	job as jobTable,
	webhookDelivery,
} from "@pasinpay/db/schema/index";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";

import { ENV } from "../env.server";
import { validGitHubWebhookSignature } from "../lib/github-webhook-signature";
import { db } from "../services";

export const githubWebhook = new Hono();

githubWebhook.post("/", async (c) => {
	const body = await c.req.text();
	if (
		!validGitHubWebhookSignature(
			body,
			c.req.header("x-hub-signature-256"),
			ENV.GITHUB_WEBHOOK_SECRET,
		)
	)
		return c.json({ error: "Invalid signature" }, 401);
	const deliveryId = c.req.header("x-github-delivery");
	const event = c.req.header("x-github-event");
	if (!deliveryId || !event)
		return c.json({ error: "Missing GitHub delivery headers" }, 400);

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(body) as Record<string, unknown>;
	} catch {
		return c.json({ error: "Invalid JSON" }, 400);
	}
	if (event !== "pull_request" && event !== "installation")
		return c.json({ accepted: false, reason: "Unsupported event" }, 202);
	if (event === "pull_request" && payload.action !== "closed")
		return c.json({ accepted: true, ignored: true }, 202);
	if (
		event === "pull_request" &&
		(payload.pull_request as { merged?: boolean } | undefined)?.merged !== true
	)
		return c.json({ accepted: true, ignored: true, reason: "not-merged" }, 202);
	const [delivery] = await db
		.insert(webhookDelivery)
		.values({ deliveryId, event, payload })
		.onConflictDoNothing()
		.returning();
	if (!delivery) return c.json({ accepted: true, duplicate: true });
	if (event === "installation" && payload.action === "created") {
		const installation = payload.installation as
			| { id?: number; account?: { login?: string; type?: string } }
			| undefined;
		const sender = payload.sender as { id?: number } | undefined;
		const [githubAccount] = sender?.id
			? await db
					.select()
					.from(account)
					.where(
						and(
							eq(account.providerId, "github"),
							eq(account.accountId, String(sender.id)),
						),
					)
					.limit(1)
			: [];
		if (
			installation?.id &&
			installation.account?.login &&
			installation.account.type
		) {
			await db
				.insert(githubInstallation)
				.values({
					installationId: String(installation.id),
					accountLogin: installation.account.login,
					accountType: installation.account.type,
					userId: githubAccount?.userId,
				})
				.onConflictDoUpdate({
					target: githubInstallation.installationId,
					set: {
						accountLogin: installation.account.login,
						accountType: installation.account.type,
						userId: githubAccount?.userId,
						updatedAt: new Date(),
					},
				});
		}
	}
	if (event === "pull_request")
		await db.insert(jobTable).values({
			kind: "github.pull_request.closed",
			payload: { deliveryId, event, payload },
		});
	return c.json({ accepted: true }, 202);
});
