import { importPKCS8, SignJWT } from "jose";

import { ENV } from "../env.server";

const GITHUB_API = "https://api.github.com";

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
