import { createAuth } from "@pasinpay/auth";
import { chainConfigFromEnv, chains } from "@pasinpay/chain";
import { createDb } from "@pasinpay/db";
import { createPublicClient, http } from "viem";

import { ENV } from "./env.server";
import {
	createIssue,
	getRepositoryPrivacy,
	linkIssue,
	listAppInstallations,
	listInstallationRepositories,
	listRepositoryIssues,
	listRepositoryPullRequests,
} from "./lib/github";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
export const chainConfig = chainConfigFromEnv(ENV);
export const chain = chains[chainConfig.id as keyof typeof chains];
if (!chain) throw new Error(`No viem chain definition for ${chainConfig.id}`);
export const publicClient = createPublicClient({
	chain,
	transport: http(chainConfig.rpcUrl || undefined),
});

export const githubService = {
	appSlug: ENV.GITHUB_APP_SLUG,
	listAppInstallations,
	listInstallationRepositories,
	listRepositoryIssues,
	getRepositoryPrivacy,
	listRepositoryPullRequests,
	createIssue,
	linkIssue,
};
