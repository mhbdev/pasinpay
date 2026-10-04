function errorText(error: unknown): string {
	if (error instanceof Error) {
		const cause = (error as Error & { cause?: unknown }).cause;
		return [error.message, cause ? errorText(cause) : ""]
			.filter(Boolean)
			.join(" ");
	}
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		const value = error as {
			shortMessage?: string;
			details?: string;
			message?: string;
		};
		return [value.shortMessage, value.details, value.message]
			.filter((item): item is string => Boolean(item))
			.join(" ");
	}
	return "";
}

export function getReadableError(
	error: unknown,
	fallback = "Something went wrong. Please try again.",
) {
	const text = errorText(error);
	const normalized = text.toLowerCase();
	if (
		normalized.includes("user rejected") ||
		normalized.includes("user denied") ||
		normalized.includes("rejected the request")
	)
		return "Transaction cancelled in your wallet. No funds were moved.";
	if (normalized.includes("insufficient funds"))
		return "Your wallet does not have enough ETH for gas. Add testnet ETH and try again.";
	if (normalized.includes("max fee per gas less than block base fee"))
		return "The network fee changed before signing. Refresh the fee estimate and try again.";
	if (
		normalized.includes("0x8baa579f") ||
		normalized.includes("invalidsignature")
	)
		return "This claim attestation is not trusted by the escrow contract. The server and on-chain attestor configuration must be aligned before claiming.";
	if (normalized.includes("0x82a49d9e") || normalized.includes("claimexpired"))
		return "This claim attestation has expired. Refresh the bounty to request a new verification.";
	if (normalized.includes("0xf525e320") || normalized.includes("invalidstatus"))
		return "The bounty changed state on-chain and no longer accepts this action. Refresh the page and try again.";
	if (normalized.includes("0x82b42900") || normalized.includes("unauthorized"))
		return "This wallet is not authorized for the selected bounty action.";
	if (normalized.includes("chain") && normalized.includes("network"))
		return "Your wallet is on the wrong network. Switch networks and try again.";
	if (
		normalized.includes("authentication required") ||
		normalized.includes("unauthorized")
	)
		return "Sign in with GitHub to continue.";
	if (normalized.includes("rpc") || normalized.includes("network request"))
		return "The network is temporarily unavailable. Please retry in a moment.";
	if (
		normalized.includes("revert") ||
		normalized.includes("execution reverted")
	)
		return "The contract rejected this action. Check the bounty status and wallet, then try again.";
	return text.length > 180 ? fallback : text || fallback;
}
