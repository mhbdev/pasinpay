import type { Session } from "@pasinpay/auth";
import type { Database } from "@pasinpay/db";

export type GitHubService = {
	appSlug?: string;
	listInstallationRepositories: (
		installationId: string,
	) => Promise<Array<{ full_name: string; html_url: string }>>;
};

export type Context = {
	session: Session | null;
	db: Database;
	github: GitHubService;
};
