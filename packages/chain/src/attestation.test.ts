import { describe, expect, test } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";

import { claimDomain, claimTypes, verifyClaimSignature } from "./attestation";

const signer = privateKeyToAccount(
	"0x1111111111111111111111111111111111111111111111111111111111111111",
);
const verifyingContract = "0x0000000000000000000000000000000000000001" as const;
const message = {
	bountyId: 17n,
	repositoryHash: `0x${"11".repeat(32)}` as `0x${string}`,
	issueNumber: 17,
	prNumber: 21n,
	commitHash: `0x${"22".repeat(32)}` as `0x${string}`,
	recipient: signer.address,
	expiresAt: 2_000_000_000n,
	nonce: 0n,
};

describe("claim attestations", () => {
	test("signs and verifies the typed claim", async () => {
		const signature = await signer.signTypedData({
			domain: claimDomain(421614, verifyingContract),
			types: claimTypes,
			primaryType: "Claim",
			message,
		});

		expect(
			await verifyClaimSignature(
				421614,
				verifyingContract,
				message,
				signature,
				signer.address,
			),
		).toBe(true);
	});

	test("rejects a changed recipient or chain domain", async () => {
		const signature = await signer.signTypedData({
			domain: claimDomain(421614, verifyingContract),
			types: claimTypes,
			primaryType: "Claim",
			message,
		});

		expect(
			await verifyClaimSignature(
				421614,
				verifyingContract,
				{ ...message, recipient: "0x0000000000000000000000000000000000000002" },
				signature,
				signer.address,
			),
		).toBe(false);
		expect(
			await verifyClaimSignature(
				42161,
				verifyingContract,
				message,
				signature,
				signer.address,
			),
		).toBe(false);
	});
});
