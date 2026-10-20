import {
	address,
	assertIsSignatureBytes,
	createKeyPairSignerFromBytes,
	createSignableMessage,
	getAddressEncoder,
	getBase58Encoder,
	getPublicKeyFromAddress,
	getUtf8Encoder,
	type Instruction,
	verifySignature,
} from "@solana/kit";
import {
	SOLANA_CLAIM_DOMAIN,
	SOLANA_DEVNET_NETWORK_DOMAIN,
	SOLANA_ED25519_PROGRAM_ID,
} from "./config";

export type SolanaClaimMessage = {
	programId: string;
	networkDomain?: Uint8Array;
	bountyAddress: string;
	bountyId: bigint;
	repositoryHash: Uint8Array;
	issueNumber: number;
	prNumber: number;
	commitHash: Uint8Array;
	claimant: string;
	expiresAt: bigint;
	nonce: Uint8Array;
};

function fixedBytes(value: Uint8Array, length: number, label: string) {
	if (value.length !== length)
		throw new RangeError(`${label} must be ${length} bytes`);
	return value;
}

export function bigintToLittleEndian(value: bigint, width: number) {
	if (value < BigInt(0))
		throw new RangeError("Integer values must not be negative");
	const result = new Uint8Array(width);
	let remaining = value;
	for (let index = 0; index < width; index += 1) {
		result[index] = Number(remaining & BigInt(255));
		remaining >>= BigInt(8);
	}
	if (remaining !== BigInt(0))
		throw new RangeError(`Integer does not fit in ${width} bytes`);
	return result;
}

export function concatBytes(...parts: Uint8Array[]) {
	const output = new Uint8Array(
		parts.reduce((size, part) => size + part.length, 0),
	);
	let offset = 0;
	for (const part of parts) {
		output.set(part, offset);
		offset += part.length;
	}
	return output;
}

export function encodeSolanaClaimMessage(input: SolanaClaimMessage) {
	const utf8 = getUtf8Encoder();
	const publicKey = getAddressEncoder();
	const networkDomain = input.networkDomain ?? SOLANA_DEVNET_NETWORK_DOMAIN;
	if (
		!Number.isInteger(input.issueNumber) ||
		input.issueNumber < 1 ||
		input.issueNumber > 0xffffffff
	) {
		throw new RangeError("Issue number must be a positive uint32");
	}
	if (
		!Number.isInteger(input.prNumber) ||
		input.prNumber < 1 ||
		input.prNumber > 0xffffffff
	) {
		throw new RangeError("Pull request number must be a positive uint32");
	}
	return concatBytes(
		new Uint8Array(utf8.encode(SOLANA_CLAIM_DOMAIN)),
		new Uint8Array(publicKey.encode(address(input.programId))),
		fixedBytes(networkDomain, 32, "networkDomain"),
		new Uint8Array(publicKey.encode(address(input.bountyAddress))),
		bigintToLittleEndian(input.bountyId, 8),
		fixedBytes(input.repositoryHash, 32, "repositoryHash"),
		bigintToLittleEndian(BigInt(input.issueNumber), 4),
		bigintToLittleEndian(BigInt(input.prNumber), 4),
		fixedBytes(input.commitHash, 32, "commitHash"),
		new Uint8Array(publicKey.encode(address(input.claimant))),
		bigintToLittleEndian(input.expiresAt, 8),
		fixedBytes(input.nonce, 32, "nonce"),
	);
}

export function bytesToHex(value: Uint8Array) {
	return `0x${Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function hexToBytes(value: string, expectedLength?: number) {
	const normalized = value.startsWith("0x") ? value.slice(2) : value;
	if (normalized.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(normalized)) {
		throw new TypeError("Expected a hex-encoded byte string");
	}
	const output = Uint8Array.from(
		{ length: normalized.length / 2 },
		(_, index) =>
			Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16),
	);
	if (expectedLength !== undefined)
		fixedBytes(output, expectedLength, "hex value");
	return output;
}

export function isValidSolanaAddress(value: string) {
	try {
		address(value);
		return true;
	} catch {
		return false;
	}
}

export async function verifySolanaRawMessage(input: {
	address: string;
	message: string;
	signature: string;
}) {
	const signature = new Uint8Array(getBase58Encoder().encode(input.signature));
	assertIsSignatureBytes(signature);
	const publicKey = await getPublicKeyFromAddress(address(input.address));
	return verifySignature(
		publicKey,
		signature,
		new Uint8Array(getUtf8Encoder().encode(input.message)),
	);
}

export async function signSolanaBytes(
	base58SecretKey: string,
	message: Uint8Array,
) {
	const secretBytes = new Uint8Array(
		getBase58Encoder().encode(base58SecretKey),
	);
	if (secretBytes.length !== 64)
		throw new Error("Solana signing key is not a 64-byte keypair");
	const signer = await createKeyPairSignerFromBytes(secretBytes);
	const [signatureDictionary] = await signer.signMessages([
		createSignableMessage(message),
	]);
	if (!signatureDictionary)
		throw new Error("Solana signer did not return a signature");
	const signature = signatureDictionary[signer.address];
	if (!signature) throw new Error("Solana signer did not return a signature");
	const publicKey = await getPublicKeyFromAddress(signer.address);
	if (!(await verifySignature(publicKey, signature, message))) {
		throw new Error("Solana attestor signature failed local verification");
	}
	return { signer: signer.address, signature: new Uint8Array(signature) };
}

export function createEd25519PrecompileData(
	publicKey: Uint8Array,
	signature: Uint8Array,
	message: Uint8Array,
) {
	fixedBytes(publicKey, 32, "publicKey");
	fixedBytes(signature, 64, "signature");
	if (message.length > 0xffff)
		throw new RangeError("Ed25519 message exceeds 65535 bytes");
	const offsets = new Uint8Array(14);
	const view = new DataView(offsets.buffer);
	view.setUint16(0, 16, true);
	view.setUint16(2, 0xffff, true);
	view.setUint16(4, 80, true);
	view.setUint16(6, 0xffff, true);
	view.setUint16(8, 112, true);
	view.setUint16(10, message.length, true);
	view.setUint16(12, 0xffff, true);
	return concatBytes(
		new Uint8Array([1, 0]),
		offsets,
		signature,
		publicKey,
		message,
	);
}

export function createEd25519VerificationInstruction(input: {
	attestor: string;
	signature: Uint8Array;
	message: Uint8Array;
}): Instruction {
	return {
		programAddress: address(SOLANA_ED25519_PROGRAM_ID),
		accounts: [],
		data: createEd25519PrecompileData(
			new Uint8Array(getAddressEncoder().encode(address(input.attestor))),
			input.signature,
			input.message,
		),
	};
}
