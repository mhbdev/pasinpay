export type BountyUiStatus =
	| "Open"
	| "Funded"
	| "ClaimPending"
	| "Paid"
	| "Disputed"
	| "Refunded"
	| "Cancelled";

export function getBountyProgress(input: {
	currentStatus: string;
	hasClaim: boolean;
	hasMergedPullRequest: boolean;
	hasOpenPullRequest: boolean;
}): boolean[] {
	return [
		true,
		input.currentStatus !== "Open",
		input.hasOpenPullRequest || input.hasMergedPullRequest,
		input.hasMergedPullRequest ||
			input.hasClaim ||
			input.currentStatus === "ClaimPending" ||
			input.currentStatus === "Paid",
		input.hasClaim,
	];
}

export function getCreatorActionAvailability(input: {
	currentStatus: string;
	isCreator: boolean;
	isExpired: boolean;
	reviewClosed: boolean;
	approved: boolean;
}) {
	const canCancel = input.isCreator && input.currentStatus === "Open";
	const canRefund =
		input.isCreator &&
		(input.currentStatus === "Funded" ||
			input.currentStatus === "ClaimPending") &&
		input.isExpired &&
		!input.approved;
	const canDispute =
		input.isCreator &&
		input.currentStatus === "ClaimPending" &&
		!input.reviewClosed;
	const canApprove =
		input.isCreator &&
		input.currentStatus === "ClaimPending" &&
		!input.approved;
	const canFinalize =
		input.isCreator &&
		input.currentStatus === "ClaimPending" &&
		input.approved &&
		input.reviewClosed;

	return {
		canCancel,
		canRefund,
		canDispute,
		canApprove,
		canFinalize,
		hasCreatorAction:
			canCancel || canRefund || canDispute || canApprove || canFinalize,
	};
}

export function isClaimButtonVisible(input: {
	currentStatus: string;
	hasOnchainClaimant: boolean;
	hasClaimAttestation: boolean;
}) {
	return (
		input.currentStatus === "Funded" &&
		!input.hasOnchainClaimant &&
		input.hasClaimAttestation
	);
}

export function getPullRequestDescription(status: string) {
	if (status === "Open") return "Awaiting merge";
	if (status === "Merged") return "Merged · verification pending";
	if (status === "Superseded")
		return "Merged · another PR was selected for this payout";
	if (status === "Verified") return "Verified evidence";
	return "Closed";
}
