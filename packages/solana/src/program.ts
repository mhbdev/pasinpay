import {
	type AccountMeta,
	AccountRole,
	type Address,
	address,
	getAddressDecoder,
	getAddressEncoder,
	getBase64Encoder,
	getProgramDerivedAddress,
	getUtf8Encoder,
	type Instruction,
} from "@solana/kit";
import {
	SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID,
	SOLANA_DEVNET_USDC_MINT,
	SOLANA_TOKEN_PROGRAM_ID,
} from "./config";
import { concatBytes } from "./encoding";

export const SOLANA_SYSTEM_PROGRAM_ID = "11111111111111111111111111111111";
export const SOLANA_INSTRUCTIONS_SYSVAR_ID =
	"Sysvar1nstructions1111111111111111111111111";

export const ANCHOR_DISCRIMINATORS = {
	initialize: new Uint8Array([175, 175, 109, 31, 13, 152, 155, 237]),
	updateConfig: new Uint8Array([29, 158, 252, 191, 10, 83, 219, 99]),
	createBounty: new Uint8Array([122, 90, 14, 143, 8, 125, 200, 2]),
	fundBounty: new Uint8Array([36, 148, 139, 239, 172, 37, 58, 255]),
	claimBounty: new Uint8Array([225, 157, 163, 238, 239, 169, 75, 226]),
	approveClaim: new Uint8Array([74, 228, 211, 63, 140, 255, 69, 210]),
	disputeClaim: new Uint8Array([101, 151, 181, 114, 26, 227, 116, 42]),
	finalizeClaim: new Uint8Array([86, 162, 202, 241, 136, 125, 52, 149]),
	resolveDispute: new Uint8Array([231, 6, 202, 6, 96, 103, 12, 230]),
	refundExpired: new Uint8Array([118, 153, 164, 244, 40, 128, 242, 250]),
	cancelBounty: new Uint8Array([79, 65, 107, 143, 128, 165, 135, 46]),
} as const;

export type SolanaBountyStatus =
	| "Open"
	| "Funded"
	| "ClaimPending"
	| "Paid"
	| "Disputed"
	| "Refunded"
	| "Cancelled";

export type SolanaBountyState = {
	id: bigint;
	creator: string;
	repositoryHash: Uint8Array;
	issueNumber: number;
	deadline: bigint;
	reviewWindow: bigint;
	reviewEnds: bigint;
	amount: bigint;
	feeAmount: bigint;
	totalFunded: bigint;
	claimant: string;
	prNumber: number;
	commitHash: Uint8Array;
	claimDigest: Uint8Array;
	status: SolanaBountyStatus;
	approved: boolean;
	attestationNonce: Uint8Array;
	bump: number;
};

export type SolanaEscrowConfig = {
	authority: string;
	attestor: string;
	feeTreasury: string;
	mint: string;
	networkDomain: Uint8Array;
	feeBps: number;
	nextBountyId: bigint;
	bump: number;
};

const statusByIndex: SolanaBountyStatus[] = [
	"Open",
	"Funded",
	"ClaimPending",
	"Paid",
	"Disputed",
	"Refunded",
	"Cancelled",
];

function u16(value: number) {
	if (!Number.isInteger(value) || value < 0 || value > 0xffff)
		throw new RangeError("Expected uint16");
	return new Uint8Array([value & 0xff, value >>> 8]);
}

function u32(value: number) {
	if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
		throw new RangeError("Expected uint32");
	return new Uint8Array([
		value & 0xff,
		(value >>> 8) & 0xff,
		(value >>> 16) & 0xff,
		(value >>> 24) & 0xff,
	]);
}

function integer(value: bigint, width: number, signed = false) {
	const min = signed ? -(BigInt(1) << BigInt(width * 8 - 1)) : BigInt(0);
	const max = signed
		? (BigInt(1) << BigInt(width * 8 - 1)) - BigInt(1)
		: (BigInt(1) << BigInt(width * 8)) - BigInt(1);
	if (value < min || value > max)
		throw new RangeError(
			`Integer does not fit in ${signed ? "i" : "u"}${width * 8}`,
		);
	let remaining =
		value < BigInt(0) ? (BigInt(1) << BigInt(width * 8)) + value : value;
	const result = new Uint8Array(width);
	for (let index = 0; index < width; index += 1) {
		result[index] = Number(remaining & BigInt(255));
		remaining >>= BigInt(8);
	}
	return result;
}

function meta(value: string, role: AccountRole): AccountMeta {
	return { address: address(value), role };
}

function instruction(
	programId: string,
	discriminator: Uint8Array,
	accounts: AccountMeta[],
	args: Uint8Array[] = [],
): Instruction {
	return {
		programAddress: address(programId),
		accounts,
		data: concatBytes(discriminator, ...args),
	};
}

function publicKey(value: string) {
	return new Uint8Array(getAddressEncoder().encode(address(value)));
}

export async function deriveConfigAddress(programId: string) {
	const [result] = await getProgramDerivedAddress({
		programAddress: address(programId),
		seeds: [getUtf8Encoder().encode("config")],
	});
	return result;
}

export async function deriveBountyAddress(programId: string, bountyId: bigint) {
	const idBytes = integer(bountyId, 8);
	const [result] = await getProgramDerivedAddress({
		programAddress: address(programId),
		seeds: [getUtf8Encoder().encode("bounty"), idBytes],
	});
	return result;
}

export async function deriveAssociatedTokenAddress(
	owner: string,
	mint = SOLANA_DEVNET_USDC_MINT,
) {
	const [result] = await getProgramDerivedAddress({
		programAddress: address(SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID),
		seeds: [
			publicKey(owner),
			publicKey(SOLANA_TOKEN_PROGRAM_ID),
			publicKey(mint),
		],
	});
	return result;
}

export function createInitializeInstruction(input: {
	programId: string;
	authority: string;
	attestor: string;
	feeTreasury: string;
	feeBps: number;
	networkDomain: Uint8Array;
	mint?: string;
}) {
	return deriveConfigAddress(input.programId).then((config) =>
		instruction(
			input.programId,
			ANCHOR_DISCRIMINATORS.initialize,
			[
				meta(input.authority, AccountRole.WRITABLE_SIGNER),
				meta(config, AccountRole.WRITABLE),
				meta(input.mint ?? SOLANA_DEVNET_USDC_MINT, AccountRole.READONLY),
				meta(SOLANA_TOKEN_PROGRAM_ID, AccountRole.READONLY),
				meta(SOLANA_SYSTEM_PROGRAM_ID, AccountRole.READONLY),
			],
			[
				publicKey(input.attestor),
				publicKey(input.feeTreasury),
				u16(input.feeBps),
				input.networkDomain,
			],
		),
	);
}

export async function createBountyInstruction(input: {
	programId: string;
	creator: string;
	config: SolanaEscrowConfig;
	repositoryHash: Uint8Array;
	issueNumber: number;
	deadline: bigint;
	reviewWindow: bigint;
}) {
	const configAddress = await deriveConfigAddress(input.programId);
	const bountyAddress = await deriveBountyAddress(
		input.programId,
		input.config.nextBountyId,
	);
	return {
		bountyAddress,
		bountyId: input.config.nextBountyId,
		instruction: instruction(
			input.programId,
			ANCHOR_DISCRIMINATORS.createBounty,
			[
				meta(configAddress, AccountRole.WRITABLE),
				meta(bountyAddress, AccountRole.WRITABLE),
				meta(input.creator, AccountRole.WRITABLE_SIGNER),
				meta(SOLANA_SYSTEM_PROGRAM_ID, AccountRole.READONLY),
			],
			[
				input.repositoryHash,
				u32(input.issueNumber),
				integer(input.deadline, 8, true),
				integer(input.reviewWindow, 8, true),
			],
		),
	};
}

export async function createFundBountyInstruction(input: {
	programId: string;
	creator: string;
	bountyId: bigint;
	rewardAmount: bigint;
	mint?: string;
}) {
	const mint = input.mint ?? SOLANA_DEVNET_USDC_MINT;
	const configAddress = await deriveConfigAddress(input.programId);
	const bountyAddress = await deriveBountyAddress(
		input.programId,
		input.bountyId,
	);
	const [creatorTokenAddress, vaultTokenAddress] = await Promise.all([
		deriveAssociatedTokenAddress(input.creator, mint),
		deriveAssociatedTokenAddress(bountyAddress, mint),
	]);
	return {
		creatorTokenAddress,
		vaultTokenAddress,
		instruction: instruction(
			input.programId,
			ANCHOR_DISCRIMINATORS.fundBounty,
			[
				meta(configAddress, AccountRole.READONLY),
				meta(bountyAddress, AccountRole.WRITABLE),
				meta(input.creator, AccountRole.WRITABLE_SIGNER),
				meta(mint, AccountRole.READONLY),
				meta(creatorTokenAddress, AccountRole.WRITABLE),
				meta(vaultTokenAddress, AccountRole.WRITABLE),
				meta(SOLANA_TOKEN_PROGRAM_ID, AccountRole.READONLY),
				meta(SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID, AccountRole.READONLY),
				meta(SOLANA_SYSTEM_PROGRAM_ID, AccountRole.READONLY),
			],
			[integer(input.rewardAmount, 8)],
		),
	};
}

export function createAssociatedTokenAccountIdempotentInstruction(input: {
	payer: string;
	owner: string;
	mint?: string;
	tokenAccount: string;
}) {
	return {
		programAddress: address(SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID),
		accounts: [
			meta(input.payer, AccountRole.WRITABLE_SIGNER),
			meta(input.tokenAccount, AccountRole.WRITABLE),
			meta(input.owner, AccountRole.READONLY),
			meta(input.mint ?? SOLANA_DEVNET_USDC_MINT, AccountRole.READONLY),
			meta(SOLANA_SYSTEM_PROGRAM_ID, AccountRole.READONLY),
			meta(SOLANA_TOKEN_PROGRAM_ID, AccountRole.READONLY),
		],
		data: new Uint8Array([1]),
	} satisfies Instruction;
}

export function createClaimInstruction(input: {
	programId: string;
	claimant: string;
	bountyId: bigint;
	prNumber: number;
	commitHash: Uint8Array;
	expiresAt: bigint;
	nonce: Uint8Array;
}) {
	return Promise.all([
		deriveConfigAddress(input.programId),
		deriveBountyAddress(input.programId, input.bountyId),
	]).then(([config, bounty]) =>
		instruction(
			input.programId,
			ANCHOR_DISCRIMINATORS.claimBounty,
			[
				meta(config, AccountRole.READONLY),
				meta(bounty, AccountRole.WRITABLE),
				meta(input.claimant, AccountRole.READONLY_SIGNER),
				meta(SOLANA_INSTRUCTIONS_SYSVAR_ID, AccountRole.READONLY),
			],
			[
				u32(input.prNumber),
				input.commitHash,
				integer(input.expiresAt, 8, true),
				input.nonce,
			],
		),
	);
}

export function createCreatorActionInstruction(input: {
	programId: string;
	creator: string;
	bountyId: bigint;
	action: "approveClaim" | "disputeClaim" | "cancelBounty";
}) {
	const discriminators = {
		approveClaim: ANCHOR_DISCRIMINATORS.approveClaim,
		disputeClaim: ANCHOR_DISCRIMINATORS.disputeClaim,
		cancelBounty: ANCHOR_DISCRIMINATORS.cancelBounty,
	};
	return deriveBountyAddress(input.programId, input.bountyId).then((bounty) =>
		instruction(input.programId, discriminators[input.action], [
			meta(bounty, AccountRole.WRITABLE),
			meta(input.creator, AccountRole.READONLY_SIGNER),
		]),
	);
}

export async function createFinalizeClaimInstruction(input: {
	programId: string;
	bountyId: bigint;
	claimant: string;
	feeTreasury: string;
	mint?: string;
}) {
	const mint = input.mint ?? SOLANA_DEVNET_USDC_MINT;
	const [config, bounty] = await Promise.all([
		deriveConfigAddress(input.programId),
		deriveBountyAddress(input.programId, input.bountyId),
	]);
	const [vaultToken, claimantToken, feeToken] = await Promise.all([
		deriveAssociatedTokenAddress(bounty, mint),
		deriveAssociatedTokenAddress(input.claimant, mint),
		deriveAssociatedTokenAddress(input.feeTreasury, mint),
	]);
	return instruction(input.programId, ANCHOR_DISCRIMINATORS.finalizeClaim, [
		meta(config, AccountRole.READONLY),
		meta(bounty, AccountRole.WRITABLE),
		meta(mint, AccountRole.READONLY),
		meta(vaultToken, AccountRole.WRITABLE),
		meta(claimantToken, AccountRole.WRITABLE),
		meta(feeToken, AccountRole.WRITABLE),
		meta(SOLANA_TOKEN_PROGRAM_ID, AccountRole.READONLY),
	]);
}

export async function createResolveDisputeInstruction(input: {
	programId: string;
	authority: string;
	bountyId: bigint;
	creator: string;
	claimant: string;
	feeTreasury: string;
	claimantBps: number;
	mint?: string;
}) {
	const mint = input.mint ?? SOLANA_DEVNET_USDC_MINT;
	const [config, bounty] = await Promise.all([
		deriveConfigAddress(input.programId),
		deriveBountyAddress(input.programId, input.bountyId),
	]);
	const [vaultToken, creatorToken, claimantToken, feeToken] = await Promise.all(
		[
			deriveAssociatedTokenAddress(bounty, mint),
			deriveAssociatedTokenAddress(input.creator, mint),
			deriveAssociatedTokenAddress(input.claimant, mint),
			deriveAssociatedTokenAddress(input.feeTreasury, mint),
		],
	);
	return instruction(
		input.programId,
		ANCHOR_DISCRIMINATORS.resolveDispute,
		[
			meta(config, AccountRole.READONLY),
			meta(input.authority, AccountRole.READONLY_SIGNER),
			meta(bounty, AccountRole.WRITABLE),
			meta(mint, AccountRole.READONLY),
			meta(vaultToken, AccountRole.WRITABLE),
			meta(creatorToken, AccountRole.WRITABLE),
			meta(claimantToken, AccountRole.WRITABLE),
			meta(feeToken, AccountRole.WRITABLE),
			meta(SOLANA_TOKEN_PROGRAM_ID, AccountRole.READONLY),
		],
		[u16(input.claimantBps)],
	);
}

export async function createRefundExpiredInstruction(input: {
	programId: string;
	payer: string;
	bountyId: bigint;
	creator: string;
	mint?: string;
}) {
	const mint = input.mint ?? SOLANA_DEVNET_USDC_MINT;
	const [config, bounty] = await Promise.all([
		deriveConfigAddress(input.programId),
		deriveBountyAddress(input.programId, input.bountyId),
	]);
	const [vaultToken, creatorToken] = await Promise.all([
		deriveAssociatedTokenAddress(bounty, mint),
		deriveAssociatedTokenAddress(input.creator, mint),
	]);
	return instruction(input.programId, ANCHOR_DISCRIMINATORS.refundExpired, [
		meta(config, AccountRole.READONLY),
		meta(bounty, AccountRole.WRITABLE),
		meta(mint, AccountRole.READONLY),
		meta(vaultToken, AccountRole.WRITABLE),
		meta(creatorToken, AccountRole.WRITABLE),
		meta(SOLANA_TOKEN_PROGRAM_ID, AccountRole.READONLY),
	]);
}

export async function fetchSolanaEscrowConfig(
	rpc: {
		getAccountInfo: (
			key: Address,
			config: { encoding: "base64" },
		) => {
			send: () => Promise<{
				value: { data: readonly [string, string] } | null;
			}>;
		};
	},
	programId: string,
): Promise<SolanaEscrowConfig | null> {
	const configAddress = await deriveConfigAddress(programId);
	const { value } = await rpc
		.getAccountInfo(configAddress, { encoding: "base64" })
		.send();
	if (!value) return null;
	const data = new Uint8Array(getBase64Encoder().encode(value.data[0]));
	if (
		data.length !== 179 ||
		data[0] !== 155 ||
		data[1] !== 12 ||
		data[2] !== 170 ||
		data[3] !== 224 ||
		data[4] !== 30 ||
		data[5] !== 250 ||
		data[6] !== 204 ||
		data[7] !== 130
	) {
		throw new Error("Solana escrow config account has an unexpected layout");
	}
	const decoder = getAddressDecoder();
	const readAddress = (offset: number) =>
		decoder.decode(data.slice(offset, offset + 32));
	const readUint = (offset: number, width: number) => {
		let result = BigInt(0);
		for (let index = width - 1; index >= 0; index -= 1)
			result = (result << BigInt(8)) | BigInt(data[offset + index] ?? 0);
		return result;
	};
	return {
		authority: readAddress(8),
		attestor: readAddress(40),
		feeTreasury: readAddress(72),
		mint: readAddress(104),
		networkDomain: data.slice(136, 168),
		feeBps: Number(readUint(168, 2)),
		nextBountyId: readUint(170, 8),
		bump: data[178] ?? 0,
	};
}

export function decodeSolanaBountyAccount(data: Uint8Array): SolanaBountyState {
	const discriminator = [237, 16, 105, 198, 19, 69, 242, 234];
	if (
		data.length !== 267 ||
		discriminator.some((value, index) => data[index] !== value)
	) {
		throw new Error("Solana bounty account has an unexpected layout");
	}
	const readUint = (offset: number, width: number, signed = false) => {
		let result = BigInt(0);
		for (let index = width - 1; index >= 0; index -= 1)
			result = (result << BigInt(8)) | BigInt(data[offset + index] ?? 0);
		if (signed && ((data[offset + width - 1] ?? 0) & 0x80) !== 0)
			result -= BigInt(1) << BigInt(width * 8);
		return result;
	};
	const decoder = getAddressDecoder();
	const status = statusByIndex[data[264] ?? -1];
	if (!status) throw new Error("Solana bounty account has an unknown state");
	return {
		id: readUint(8, 8),
		creator: decoder.decode(data.slice(16, 48)),
		repositoryHash: data.slice(48, 80),
		issueNumber: Number(readUint(80, 4)),
		deadline: readUint(84, 8, true),
		reviewWindow: readUint(92, 8, true),
		reviewEnds: readUint(100, 8, true),
		amount: readUint(108, 8),
		feeAmount: readUint(116, 8),
		totalFunded: readUint(124, 8),
		claimant: decoder.decode(data.slice(132, 164)),
		prNumber: Number(readUint(164, 4)),
		commitHash: data.slice(168, 200),
		claimDigest: data.slice(200, 232),
		attestationNonce: data.slice(232, 264),
		status,
		approved: data[265] === 1,
		bump: data[266] ?? 0,
	};
}
