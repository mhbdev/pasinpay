import type { Address, Hex } from "viem";

export enum BountyStatus {
	Open = "Open",
	Funded = "Funded",
	ClaimPending = "ClaimPending",
	Paid = "Paid",
	Disputed = "Disputed",
	Refunded = "Refunded",
	Cancelled = "Cancelled",
}

export type ChainConfig = {
	id: number;
	name: string;
	escrowAddress: Address;
	tokenAddress: Address;
	tokenSymbol: "USDG" | "USDC";
	tokenEip712Name: string;
	tokenEip712Version: string;
	feeTreasury: Address;
	feeBps: number;
	explorerUrl: string;
	rpcUrl?: string;
};

export type SupportedChainId = 42161 | 421614 | 5042 | 5042002;
/** @deprecated Use SupportedChainId. */
export type SupportedArbitrumChainId = 42161 | 421614;

export type Bounty = {
	id: string;
	onchainBountyId: bigint;
	creator: Address;
	amount: bigint;
	feeAmount: bigint;
	totalFunded: bigint;
	deadline: number;
	reviewWindow: number;
	reviewEnds: number | null;
	issueNumber: number;
	repository: string;
	repositoryHash: Hex;
	title: string;
	status: BountyStatus;
	claimant?: Address | null;
	claimDigest?: Hex | null;
};

export type GitHubEvidence = {
	repository: string;
	repositoryHash: Hex;
	issueNumber: number;
	prNumber: number;
	commitHash: Hex;
	mergedAt: string;
	authorLogin: string;
	prUrl: string;
};

export type Attestation = GitHubEvidence & {
	bountyId: bigint;
	recipient: Address;
	expiresAt: bigint;
	nonce: bigint;
	digest: Hex;
	signature: Hex;
};

export type Settlement = {
	bountyId: bigint;
	recipient: Address;
	amount: bigint;
	feeAmount: bigint;
	transactionHash: Hex;
};

export type TransactionState =
	| { status: "idle" }
	| { status: "confirming"; hash?: Hex }
	| { status: "confirmed"; hash: Hex }
	| { status: "error"; message: string; hash?: Hex };
