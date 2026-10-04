import {
	bigint,
	index,
	integer,
	jsonb,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const walletLinkChallenge = pgTable(
	"wallet_link_challenge",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id").notNull(),
		nonce: text("nonce").notNull().unique(),
		message: text("message").notNull(),
		chainId: integer("chain_id").notNull(),
		expiresAt: timestamp("expires_at").notNull(),
		usedAt: timestamp("used_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("wallet_challenge_user_idx").on(table.userId)],
);

export const walletLink = pgTable(
	"wallet_link",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id").notNull(),
		walletAddress: text("wallet_address").notNull().unique(),
		chainId: integer("chain_id").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [uniqueIndex("wallet_link_user_idx").on(table.userId)],
);

export const githubInstallation = pgTable("github_installation", {
	id: uuid("id").defaultRandom().primaryKey(),
	installationId: text("installation_id").notNull().unique(),
	accountLogin: text("account_login").notNull(),
	accountType: text("account_type").notNull(),
	userId: text("user_id"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const repository = pgTable(
	"repository",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		installationId: uuid("installation_id")
			.notNull()
			.references(() => githubInstallation.id, { onDelete: "cascade" }),
		fullName: text("full_name").notNull(),
		repositoryHash: text("repository_hash").notNull(),
		htmlUrl: text("html_url").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("repository_installation_name_idx").on(
			table.installationId,
			table.fullName,
		),
	],
);

export const bounty = pgTable(
	"bounty",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		userId: text("user_id").notNull(),
		chainId: integer("chain_id").notNull().default(421614),
		onchainBountyId: bigint("onchain_bounty_id", { mode: "bigint" }),
		creatorWallet: text("creator_wallet").notNull(),
		repository: text("repository").notNull(),
		repositoryHash: text("repository_hash").notNull(),
		issueNumber: integer("issue_number").notNull(),
		issueTitle: text("issue_title").notNull().default(""),
		issueUrl: text("issue_url").notNull().default(""),
		creationMode: text("creation_mode").notNull().default("existing"),
		title: text("title").notNull(),
		amount: bigint("amount", { mode: "bigint" }).notNull(),
		feeAmount: bigint("fee_amount", { mode: "bigint" })
			.notNull()
			.default(BigInt(0)),
		totalFunded: bigint("total_funded", { mode: "bigint" })
			.notNull()
			.default(BigInt(0)),
		deadline: timestamp("deadline").notNull(),
		reviewWindowSeconds: integer("review_window_seconds").notNull(),
		reviewEnds: timestamp("review_ends"),
		claimantWallet: text("claimant_wallet"),
		claimDigest: text("claim_digest"),
		status: text("status").notNull().default("Open"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("bounty_chain_id_idx").on(table.onchainBountyId),
		index("bounty_creator_idx").on(table.creatorWallet),
		index("bounty_status_idx").on(table.status),
	],
);

export const claim = pgTable(
	"claim",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		bountyId: uuid("bounty_id")
			.notNull()
			.references(() => bounty.id, { onDelete: "cascade" }),
		githubPrNumber: integer("github_pr_number").notNull(),
		mergeCommitSha: text("merge_commit_sha").notNull(),
		claimantWallet: text("claimant_wallet").notNull(),
		attestationDigest: text("attestation_digest").notNull().unique(),
		attestationSignature: text("attestation_signature").notNull(),
		attestationNonce: bigint("attestation_nonce", { mode: "bigint" })
			.notNull()
			.default(BigInt(0)),
		attestationExpiresAt: timestamp("attestation_expires_at")
			.notNull()
			.defaultNow(),
		githubDeliveryId: text("github_delivery_id").notNull(),
		evidence: jsonb("evidence").notNull(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [
		uniqueIndex("claim_bounty_pr_idx").on(table.bountyId, table.githubPrNumber),
		uniqueIndex("claim_bounty_idx").on(table.bountyId),
	],
);

export const settlement = pgTable(
	"settlement",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		bountyId: uuid("bounty_id")
			.notNull()
			.references(() => bounty.id, { onDelete: "cascade" }),
		recipient: text("recipient").notNull(),
		amount: bigint("amount", { mode: "bigint" }).notNull(),
		feeAmount: bigint("fee_amount", { mode: "bigint" })
			.notNull()
			.default(BigInt(0)),
		transactionHash: text("transaction_hash").notNull().unique(),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [uniqueIndex("settlement_bounty_idx").on(table.bountyId)],
);

export const webhookDelivery = pgTable("webhook_delivery", {
	id: uuid("id").defaultRandom().primaryKey(),
	deliveryId: text("delivery_id").notNull().unique(),
	event: text("event").notNull(),
	payload: jsonb("payload").notNull(),
	receivedAt: timestamp("received_at").defaultNow().notNull(),
});

export const job = pgTable(
	"job",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		kind: text("kind").notNull(),
		payload: jsonb("payload").notNull(),
		status: text("status").notNull().default("pending"),
		attempts: integer("attempts").notNull().default(0),
		availableAt: timestamp("available_at").defaultNow().notNull(),
		lockedAt: timestamp("locked_at"),
		lastError: text("last_error"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(table) => [index("job_ready_idx").on(table.status, table.availableAt)],
);

export const chainCursor = pgTable("chain_cursor", {
	id: text("id").primaryKey(),
	chainId: integer("chain_id").notNull(),
	lastBlock: bigint("last_block", { mode: "bigint" })
		.notNull()
		.default(BigInt(0)),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const domainTables = {
	walletLinkChallenge,
	walletLink,
	githubInstallation,
	repository,
	bounty,
	claim,
	settlement,
	webhookDelivery,
	job,
	chainCursor,
};
