import { describe, expect, test } from "bun:test";
import {
	createSignableMessage,
	generateKeyPairSigner,
	getBase58Decoder,
} from "@solana/kit";
import { SOLANA_CLAIM_DOMAIN } from "./config";
import {
	createEd25519PrecompileData,
	encodeSolanaClaimMessage,
	verifySolanaRawMessage,
} from "./encoding";

const baseClaim = {
	programId: "11111111111111111111111111111111",
	bountyAddress: "Vote111111111111111111111111111111111111111",
	bountyId: 17n,
	repositoryHash: new Uint8Array(32).fill(1),
	issueNumber: 9,
	prNumber: 23,
	commitHash: new Uint8Array(32).fill(2),
	claimant: "Stake11111111111111111111111111111111111111",
	expiresAt: 1_800_000_000n,
	nonce: new Uint8Array(32).fill(3),
};

describe("Solana claim messages", () => {
	test("encodes a fixed, Devnet-bound message and binds each claim field", () => {
		const message = encodeSolanaClaimMessage(baseClaim);
		expect(
			new TextDecoder().decode(message.slice(0, SOLANA_CLAIM_DOMAIN.length)),
		).toBe(SOLANA_CLAIM_DOMAIN);
		expect(message.length).toBe(
			SOLANA_CLAIM_DOMAIN.length +
				32 +
				32 +
				32 +
				8 +
				32 +
				4 +
				4 +
				32 +
				32 +
				8 +
				32,
		);
		expect(message).not.toEqual(
			encodeSolanaClaimMessage({ ...baseClaim, prNumber: 24 }),
		);
		expect(message).not.toEqual(
			encodeSolanaClaimMessage({
				...baseClaim,
				networkDomain: new Uint8Array(32),
			}),
		);
	});

	test("rejects malformed fixed-width claim data", () => {
		expect(() =>
			encodeSolanaClaimMessage({
				...baseClaim,
				commitHash: new Uint8Array(31),
			}),
		).toThrow("commitHash must be 32 bytes");
		expect(() =>
			encodeSolanaClaimMessage({ ...baseClaim, prNumber: 0 }),
		).toThrow("positive uint32");
	});

	test("constructs the exact single-signature Ed25519 precompile payload", () => {
		const publicKey = new Uint8Array(32).fill(5);
		const signature = new Uint8Array(64).fill(6);
		const message = new Uint8Array([1, 2, 3, 4]);
		const data = createEd25519PrecompileData(publicKey, signature, message);
		const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
		expect(data.slice(0, 2)).toEqual(new Uint8Array([1, 0]));
		expect(view.getUint16(2, true)).toBe(16);
		expect(view.getUint16(4, true)).toBe(0xffff);
		expect(view.getUint16(6, true)).toBe(80);
		expect(view.getUint16(8, true)).toBe(0xffff);
		expect(view.getUint16(10, true)).toBe(112);
		expect(view.getUint16(12, true)).toBe(message.length);
		expect(view.getUint16(14, true)).toBe(0xffff);
		expect(data.slice(16, 80)).toEqual(signature);
		expect(data.slice(80, 112)).toEqual(publicKey);
		expect(data.slice(112)).toEqual(message);
	});

	test("verifies raw wallet-link messages against the claimed address", async () => {
		const signer = await generateKeyPairSigner();
		const message = new TextEncoder().encode(
			"PasinPay wallet linking\nNonce: one-use",
		);
		const [signed] = await signer.signMessages([
			createSignableMessage(message),
		]);
		if (!signed) throw new Error("Test signer returned no signature");
		const signature = signed[signer.address];
		if (!signature) throw new Error("Test signer returned no wallet signature");
		const encoded = getBase58Decoder().decode(signature);
		expect(
			await verifySolanaRawMessage({
				address: signer.address,
				message: new TextDecoder().decode(message),
				signature: encoded,
			}),
		).toBe(true);
		expect(
			await verifySolanaRawMessage({
				address: signer.address,
				message: "different message",
				signature: encoded,
			}),
		).toBe(false);
	});
});
