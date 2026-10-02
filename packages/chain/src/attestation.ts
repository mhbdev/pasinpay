import { type Address, type Hex, hashTypedData, verifyTypedData } from "viem";

export const claimTypes = {
	Claim: [
		{ name: "bountyId", type: "uint256" },
		{ name: "repositoryHash", type: "bytes32" },
		{ name: "issueNumber", type: "uint32" },
		{ name: "prNumber", type: "uint256" },
		{ name: "commitHash", type: "bytes32" },
		{ name: "recipient", type: "address" },
		{ name: "expiresAt", type: "uint64" },
		{ name: "nonce", type: "uint256" },
	],
} as const;

export type ClaimMessage = {
	bountyId: bigint;
	repositoryHash: Hex;
	issueNumber: number;
	prNumber: bigint;
	commitHash: Hex;
	recipient: Address;
	expiresAt: bigint;
	nonce: bigint;
};

export function claimDomain(chainId: number, verifyingContract: Address) {
	return {
		name: "PasinPay",
		version: "1",
		chainId,
		verifyingContract,
	} as const;
}

export function claimDigest(
	chainId: number,
	verifyingContract: Address,
	message: ClaimMessage,
) {
	return hashTypedData({
		domain: claimDomain(chainId, verifyingContract),
		types: claimTypes,
		primaryType: "Claim",
		message,
	});
}

export function verifyClaimSignature(
	chainId: number,
	verifyingContract: Address,
	message: ClaimMessage,
	signature: Hex,
	expectedSigner: Address,
) {
	return verifyTypedData({
		address: expectedSigner,
		domain: claimDomain(chainId, verifyingContract),
		types: claimTypes,
		primaryType: "Claim",
		message,
		signature,
	});
}
