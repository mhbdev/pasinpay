import { randomUUID } from "node:crypto";
import { requireMcpAuth } from "@better-auth/mcp";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
	account,
	bounty,
	githubInstallation,
	mcpAuditLog,
	repository,
	walletLink,
} from "@pasinpay/db/schema/index";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { ENV } from "../env.server";
import { auth, db, githubService } from "../services";

const webUrl = ENV.CORS_ORIGIN;
const mcpResource = new URL("/mcp", ENV.BETTER_AUTH_URL).toString();

function toolResult(value: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value) }],
		structuredContent: { data: value },
	};
}

function makeServer(userId: string, scopes: string[]) {
	const server = new McpServer({ name: "pasinpay", version: "1.0.0" });
	server.registerTool(
		"search_bounties",
		{
			description:
				"Search funded PasinPay GitHub bounties available for contributors.",
			inputSchema: z.object({
				query: z.string().max(120).optional(),
				limit: z.number().int().min(1).max(25).default(10),
			}),
		},
		async ({ query, limit }) => {
			const filters = [eq(bounty.status, "Funded")];
			if (query?.trim()) {
				const term = `%${query.trim()}%`;
				const searchFilter = or(
					ilike(bounty.title, term),
					ilike(bounty.repository, term),
					ilike(bounty.issueTitle, term),
				);
				if (searchFilter) filters.push(searchFilter);
			}
			const rows = await db
				.select({
					id: bounty.id,
					title: bounty.title,
					repository: bounty.repository,
					issueNumber: bounty.issueNumber,
					issueTitle: bounty.issueTitle,
					issueUrl: bounty.issueUrl,
					amount: bounty.amount,
					chainId: bounty.chainId,
					deadline: bounty.deadline,
				})
				.from(bounty)
				.where(and(...filters))
				.orderBy(desc(bounty.createdAt))
				.limit(limit);
			return toolResult(
				rows.map((row) => ({
					...row,
					amount: row.amount.toString(),
					deadline: row.deadline.toISOString(),
				})),
			);
		},
	);
	server.registerTool(
		"get_bounty",
		{
			description:
				"Get the public details and current claim status for one bounty.",
			inputSchema: z.object({ bountyId: z.string().uuid() }),
		},
		async ({ bountyId }) => {
			const [row] = await db
				.select({
					id: bounty.id,
					title: bounty.title,
					repository: bounty.repository,
					issueNumber: bounty.issueNumber,
					issueTitle: bounty.issueTitle,
					issueUrl: bounty.issueUrl,
					amount: bounty.amount,
					feeAmount: bounty.feeAmount,
					totalFunded: bounty.totalFunded,
					chainId: bounty.chainId,
					status: bounty.status,
					deadline: bounty.deadline,
					onchainBountyId: bounty.onchainBountyId,
					createdAt: bounty.createdAt,
				})
				.from(bounty)
				.where(eq(bounty.id, bountyId))
				.limit(1);
			if (!row) return toolResult({ error: "Bounty not found" });
			return toolResult({
				...row,
				amount: row.amount.toString(),
				feeAmount: row.feeAmount.toString(),
				totalFunded: row.totalFunded.toString(),
				onchainBountyId: row.onchainBountyId?.toString() ?? null,
				deadline: row.deadline.toISOString(),
			});
		},
	);
	server.registerTool(
		"get_bounty_issue",
		{
			description:
				"Fetch the linked GitHub issue description and repository context for a bounty.",
			inputSchema: z.object({ bountyId: z.string().uuid() }),
		},
		async ({ bountyId }) => {
			const [row] = await db
				.select({ bounty, installationId: githubInstallation.installationId })
				.from(bounty)
				.innerJoin(repository, eq(repository.fullName, bounty.repository))
				.innerJoin(
					githubInstallation,
					eq(repository.installationId, githubInstallation.id),
				)
				.where(eq(bounty.id, bountyId))
				.limit(1);
			if (!row)
				return toolResult({
					error: "Bounty or repository installation not found",
				});
			const issues = await githubService.listRepositoryIssues(
				row.installationId,
				row.bounty.repository,
			);
			const issue = issues.find(
				(item) => item.number === row.bounty.issueNumber,
			);
			return toolResult(
				issue
					? { repository: row.bounty.repository, ...issue }
					: {
							error: "Linked open issue is unavailable",
							issueUrl: row.bounty.issueUrl,
						},
			);
		},
	);
	server.registerTool(
		"get_account_setup",
		{
			description:
				"Check whether the signed-in PasinPay user has linked GitHub, an installed repository, and a payout wallet.",
			inputSchema: z.object({}),
		},
		async () => {
			const [wallet] = await db
				.select({
					walletAddress: walletLink.walletAddress,
					chainId: walletLink.chainId,
				})
				.from(walletLink)
				.where(eq(walletLink.userId, userId))
				.limit(1);
			const [github] = await db
				.select({ accountId: account.accountId })
				.from(account)
				.where(
					and(eq(account.userId, userId), eq(account.providerId, "github")),
				)
				.limit(1);
			const repositories = await db
				.select({ count: sql<number>`count(*)::int` })
				.from(repository)
				.innerJoin(
					githubInstallation,
					eq(repository.installationId, githubInstallation.id),
				)
				.where(eq(githubInstallation.userId, userId));
			return toolResult({
				githubLinked: Boolean(github),
				installedRepositoryCount: repositories[0]?.count ?? 0,
				payoutWallet: wallet?.walletAddress ?? null,
				chainId: wallet?.chainId ?? null,
				readyToCreateBounty: Boolean(
					github && wallet && (repositories[0]?.count ?? 0) > 0,
				),
			});
		},
	);
	server.registerTool(
		"prepare_bounty_draft",
		{
			description:
				"Prepare bounty details for the user to review and fund in PasinPay. This does not create an issue, submit a transaction, or move funds.",
			inputSchema: z.object({
				repository: z.string().min(3).max(200),
				issueNumber: z.number().int().positive(),
				title: z.string().min(4).max(200),
				rewardUsd: z.number().positive().max(1000000),
				deadline: z.string().datetime(),
			}),
		},
		async ({
			repository: repoName,
			issueNumber,
			title,
			rewardUsd,
			deadline,
		}) => {
			if (!scopes.includes("bounties:write"))
				return toolResult({
					error:
						"Authorize the bounties:write scope to prepare bounty requests",
				});
			const [authorized] = await db
				.select({
					id: repository.id,
					fullName: repository.fullName,
					installationId: githubInstallation.installationId,
				})
				.from(repository)
				.innerJoin(
					githubInstallation,
					eq(repository.installationId, githubInstallation.id),
				)
				.where(
					and(
						eq(githubInstallation.userId, userId),
						sql`lower(${repository.fullName}) = lower(${repoName})`,
					),
				)
				.limit(1);
			if (!authorized)
				return toolResult({
					error: "Install the PasinPay GitHub App on this repository first",
				});
			const [issue] = (
				await githubService.listRepositoryIssues(
					authorized.installationId,
					authorized.fullName,
				)
			).filter((item) => item.number === issueNumber);
			if (!issue)
				return toolResult({
					error:
						"Select an open issue from a repository linked to this account",
				});
			const [wallet] = await db
				.select({
					walletAddress: walletLink.walletAddress,
					chainId: walletLink.chainId,
				})
				.from(walletLink)
				.where(eq(walletLink.userId, userId))
				.limit(1);
			const url = new URL("/create", webUrl);
			url.searchParams.set("mcp", "1");
			url.searchParams.set("repository", authorized.fullName);
			url.searchParams.set("issueNumber", String(issueNumber));
			url.searchParams.set("title", title);
			url.searchParams.set("rewardUsd", String(rewardUsd));
			url.searchParams.set("deadline", deadline);
			await db.insert(mcpAuditLog).values({
				id: randomUUID(),
				userId,
				action: "prepare_bounty_draft",
				details: { repository: authorized.fullName, issueNumber, rewardUsd },
			});
			return toolResult({
				status: "awaiting_user_review",
				issue: {
					number: issue.number,
					title: issue.title,
					url: issue.html_url,
				},
				rewardUsd,
				deadline,
				wallet: wallet?.walletAddress ?? null,
				chainId: wallet?.chainId ?? null,
				approvalUrl: url.toString(),
				nextStep:
					"The user must review the details, connect their wallet, and approve funding in PasinPay.",
			});
		},
	);
	return server;
}

export const mcpPost = requireMcpAuth(
	auth,
	async (request, claims) => {
		const userId = typeof claims.sub === "string" ? claims.sub : "";
		if (!userId) return new Response("Invalid user token", { status: 401 });
		const scopes = String(claims.scope ?? "")
			.split(/\s+/)
			.filter(Boolean);
		const handler = createMcpHandler(() => makeServer(userId, scopes), {
			legacy: "reject",
		});
		return handler.fetch(request);
	},
	{ resource: mcpResource, requiredScopes: ["bounties:read"] },
);
