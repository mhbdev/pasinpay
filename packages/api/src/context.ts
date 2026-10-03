import type { Session } from "@pasinpay/auth";
import type { ChainConfig } from "@pasinpay/chain";
import type { Database } from "@pasinpay/db";

export type GitHubService = {
	appSlug?: string;
	listAppInstallations: () => Promise<
		Array<{
			id: number;
			account: { id: number; login: string; type: string };
		}>
	>;
	listInstallationRepositories: (
		installationId: string,
	) => Promise<Array<{ full_name: string; html_url: string }>>;
	listRepositoryIssues: (
		installationId: string,
		repository: string,
		search?: string,
	) => Promise<
		Array<{
			number: number;
			title: string;
			body: string | null;
			html_url: string;
			updated_at: string;
		}>
	>;
	listRepositoryPullRequests: (
		installationId: string,
		repository: string,
		issueNumber: number,
	) => Promise<
		Array<{
			number: number;
			title: string;
			state: "open" | "closed";
			merged_at: string | null;
			merge_commit_sha: string | null;
			html_url: string;
			updated_at: string;
			user: { login: string; id: number } | null;
		}>
	>;
	createIssue: (
		installationId: string,
		repository: string,
		input: { title: string; body: string },
	) => Promise<{
		number: number;
		title: string;
		body: string | null;
		html_url: string;
	}>;
	linkIssue: (
		installationId: string,
		repository: string,
		issueNumber: number,
		input: { title: string; body: string },
	) => Promise<{
		number: number;
		title: string;
		body: string | null;
		html_url: string;
	}>;
};

export type Context = {
	session: Session | null;
	db: Database;
	github: GitHubService;
	chain: ChainConfig;
};
