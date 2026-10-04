import { describe, expect, test } from "bun:test";

import { getPullRequestStatus } from "./pull-request-status";

describe("pull request settlement status", () => {
	test("keeps an open pull request actionable", () => {
		expect(
			getPullRequestStatus({
				hasCanonicalClaim: false,
				hasClaimForPullRequest: false,
				mergedAt: null,
				state: "open",
			}),
		).toBe("Open");
	});

	test("marks a merged pull request as pending until a claim exists", () => {
		expect(
			getPullRequestStatus({
				hasCanonicalClaim: false,
				hasClaimForPullRequest: false,
				mergedAt: "2026-10-04T18:02:07Z",
				state: "closed",
			}),
		).toBe("Merged");
	});

	test("marks only the canonical claimed pull request as verified", () => {
		expect(
			getPullRequestStatus({
				hasCanonicalClaim: true,
				hasClaimForPullRequest: true,
				mergedAt: "2026-10-04T18:02:11Z",
				state: "closed",
			}),
		).toBe("Verified");
	});

	test("marks competing merged pull requests as superseded", () => {
		expect(
			getPullRequestStatus({
				hasCanonicalClaim: true,
				hasClaimForPullRequest: false,
				mergedAt: "2026-10-04T18:02:07Z",
				state: "closed",
			}),
		).toBe("Superseded");
	});

	test("preserves a closed but unmerged pull request as closed", () => {
		expect(
			getPullRequestStatus({
				hasCanonicalClaim: true,
				hasClaimForPullRequest: false,
				mergedAt: null,
				state: "closed",
			}),
		).toBe("Closed");
	});
});
