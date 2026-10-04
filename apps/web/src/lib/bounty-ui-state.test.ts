import { describe, expect, test } from "bun:test";

import {
	getBountyProgress,
	getCreatorActionAvailability,
	getPullRequestDescription,
	isClaimButtonVisible,
} from "./bounty-ui-state";

describe("bounty UI state", () => {
	test("progresses through the funded, claim, and paid states", () => {
		expect(
			getBountyProgress({
				currentStatus: "Funded",
				hasClaim: false,
				hasMergedPullRequest: true,
				hasOpenPullRequest: false,
			}),
		).toEqual([true, true, true, true, false]);
		expect(
			getBountyProgress({
				currentStatus: "Paid",
				hasClaim: true,
				hasMergedPullRequest: true,
				hasOpenPullRequest: false,
			}),
		).toEqual([true, true, true, true, true]);
	});

	test("only shows the claim action for a funded bounty with an attestation", () => {
		expect(
			isClaimButtonVisible({
				currentStatus: "Funded",
				hasOnchainClaimant: false,
				hasClaimAttestation: true,
			}),
		).toBe(true);
		expect(
			isClaimButtonVisible({
				currentStatus: "ClaimPending",
				hasOnchainClaimant: true,
				hasClaimAttestation: true,
			}),
		).toBe(false);
	});

	test("exposes only the valid creator action for each settlement phase", () => {
		expect(
			getCreatorActionAvailability({
				currentStatus: "Open",
				isCreator: true,
				isExpired: false,
				reviewClosed: false,
				approved: false,
			}),
		).toMatchObject({ canCancel: true, hasCreatorAction: true });
		expect(
			getCreatorActionAvailability({
				currentStatus: "ClaimPending",
				isCreator: true,
				isExpired: false,
				reviewClosed: false,
				approved: false,
			}),
		).toMatchObject({ canApprove: true, canDispute: true, canFinalize: false });
		expect(
			getCreatorActionAvailability({
				currentStatus: "ClaimPending",
				isCreator: true,
				isExpired: false,
				reviewClosed: true,
				approved: true,
			}),
		).toMatchObject({
			canFinalize: true,
			canApprove: false,
			canDispute: false,
		});
	});

	test("never exposes creator actions to another wallet", () => {
		expect(
			getCreatorActionAvailability({
				currentStatus: "Open",
				isCreator: false,
				isExpired: true,
				reviewClosed: true,
				approved: false,
			}),
		).toMatchObject({
			canCancel: false,
			canRefund: false,
			canDispute: false,
			canApprove: false,
			canFinalize: false,
			hasCreatorAction: false,
		});
	});

	test("uses clear copy for competing merged pull requests", () => {
		expect(getPullRequestDescription("Superseded")).toBe(
			"Merged · another PR was selected for this payout",
		);
	});
});
