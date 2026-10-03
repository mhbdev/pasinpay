import { importPKCS8, SignJWT } from "jose";

import { ENV } from "../env.server";

const GITHUB_API = "https://api.github.com";

export type GitHubInstallationRepository = {
	full_name: string;
	html_url: string;
};

export type GitHubAppInstallation = {
	id: number;
	account: {
		id: number;
		login: string;
		type: string;
	};
};

export type GitHubIssue = {
	number: number;
	title: string;
	body: string | null;
	html_url: string;
	updated_at: string;
};

function required(name: string, value: string | undefined) {
	if (!value) throw new Error(`${name} is not configured`);
	return value;
}

export async function createGitHubAppJwt() {
	const appId = required("GITHUB_APP_ID", ENV.GITHUB_APP_ID);
	const privateKey = required(
		"GITHUB_APP_PRIVATE_KEY",
		ENV.GITHUB_APP_PRIVATE_KEY,
	).replace(/\\n/g, "\n");
	const key = await importPKCS8(privateKey, "RS256");
	return new SignJWT({})
		.setProtectedHeader({ alg: "RS256", typ: "JWT" })
		.setIssuedAt(Math.floor(Date.now() / 1000) - 60)
		.setExpirationTime("9m")
		.setIssuer(appId)
		.sign(key);
}

export async function createInstallationToken(installationId: string) {
	const jwt = await createGitHubAppJwt();
	const response = await fetch(
		`${GITHUB_API}/app/installations/${installationId}/access_tokens`,
		{
			method: "POST",
			headers: {
				accept: "application/vnd.github+json",
				authorization: `Bearer ${jwt}`,
				"x-github-api-version": "2022-11-28",
			},
		},
	);
	if (!response.ok)
		throw new Error(`GitHub installation token failed: ${response.status}`);
	return ((await response.json()) as { token: string }).token;
}

export async function listAppInstallations() {
	const jwt = await createGitHubAppJwt();
	const installations: GitHubAppInstallation[] = [];
	for (let page = 1; page <= 10; page += 1) {
		const result = await githubRequest<GitHubAppInstallation[]>(
			`/app/installations?per_page=100&page=${page}`,
			jwt,
		);
		installations.push(...result);
		if (result.length < 100) break;
	}
	return installations;
}

export async function githubRequest<T>(
	path: string,
	token: string,
): Promise<T> {
	const response = await fetch(`${GITHUB_API}${path}`, {
		headers: {
			accept: "application/vnd.github+json",
			authorization: `Bearer ${token}`,
			"x-github-api-version": "2022-11-28",
		},
	});
	if (!response.ok)
		throw new Error(`GitHub request failed: ${response.status}`);
	return response.json() as Promise<T>;
}

async function githubRequestJson<T>(
	path: string,
	token: string,
	method: "POST" | "PATCH",
	body: unknown,
): Promise<T> {
	const response = await fetch(`${GITHUB_API}${path}`, {
		method,
		headers: {
			accept: "application/vnd.github+json",
			"content-type": "application/json",
			authorization: `Bearer ${token}`,
			"x-github-api-version": "2022-11-28",
		},
		body: JSON.stringify(body),
	});
	if (!response.ok) {
		const detail = await response.text();
		throw new Error(
			`GitHub request failed: ${response.status} ${detail.slice(0, 200)}`,
		);
	}
	return response.json() as Promise<T>;
}

export async function listInstallationRepositories(installationId: string) {
	const token = await createInstallationToken(installationId);
	const repositories: GitHubInstallationRepository[] = [];
	for (let page = 1; page <= 10; page += 1) {
		const result = await githubRequest<{
			repositories: GitHubInstallationRepository[];
		}>(`/installation/repositories?per_page=100&page=${page}`, token);
		repositories.push(...result.repositories);
		if (result.repositories.length < 100) break;
	}
	return repositories;
}

export async function listRepositoryIssues(
	installationId: string,
	repository: string,
	search = "",
) {
	const token = await createInstallationToken(installationId);
	const result = await githubRequest<{
		items: GitHubIssue[];
	}>(
		`/repos/${repository}/issues?state=open&per_page=100&sort=updated&direction=desc`,
		token,
	);
	const normalized = search.trim().toLowerCase();
	return result.items
		.filter(
			(issue) =>
				!normalized ||
				`${issue.number} ${issue.title}`.toLowerCase().includes(normalized),
		)
		.slice(0, 50);
}

export async function createIssue(
	installationId: string,
	repository: string,
	input: { title: string; body: string },
) {
	const token = await createInstallationToken(installationId);
	return githubRequestJson<GitHubIssue>(
		`/repos/${repository}/issues`,
		token,
		"POST",
		input,
	);
}

export async function linkIssue(
	installationId: string,
	repository: string,
	issueNumber: number,
	input: { title: string; body: string },
) {
	const token = await createInstallationToken(installationId);
	return githubRequestJson<GitHubIssue>(
		`/repos/${repository}/issues/${issueNumber}`,
		token,
		"PATCH",
		input,
	);
}
