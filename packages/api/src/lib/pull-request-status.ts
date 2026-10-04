export type PullRequestStatus =
	| "Open"
	| "Closed"
	| "Merged"
	| "Verified"
	| "Superseded";

export function getPullRequestStatus(input: {
	hasCanonicalClaim: boolean;
	hasClaimForPullRequest: boolean;
	mergedAt: string | null;
	state: "open" | "closed";
}): PullRequestStatus {
	if (input.hasClaimForPullRequest) return "Verified";
	if (input.mergedAt) return input.hasCanonicalClaim ? "Superseded" : "Merged";
	return input.state === "closed" ? "Closed" : "Open";
}
