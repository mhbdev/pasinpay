import { address } from "@solana/kit";

export const SOLANA_DEVNET_ID = 103;
export const SOLANA_DEVNET_NAME = "Solana Devnet";
export const SOLANA_DEVNET_RPC_URL = "https://api.devnet.solana.com";
export const SOLANA_DEVNET_USDC_MINT =
	"4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";
export const SOLANA_TOKEN_PROGRAM_ID =
	"TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const SOLANA_ASSOCIATED_TOKEN_PROGRAM_ID =
	"ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
export const SOLANA_ED25519_PROGRAM_ID =
	"Ed25519SigVerify111111111111111111111111111";
export const SOLANA_DEVNET_EXPLORER_URL =
	"https://explorer.solana.com/?cluster=devnet";
export const SOLANA_CLAIM_DOMAIN = "PASINPAY_SOLANA_CLAIM_V1";
export const SOLANA_DEVNET_NETWORK_DOMAIN = new Uint8Array([
	184, 147, 172, 129, 201, 67, 104, 44, 175, 61, 56, 250, 143, 65, 217, 108, 23,
	252, 53, 33, 77, 42, 249, 131, 96, 39, 143, 107, 49, 200, 135, 175,
]);

export type SolanaNetworkConfig = {
	id: typeof SOLANA_DEVNET_ID;
	name: typeof SOLANA_DEVNET_NAME;
	rpcUrl: string;
	programId: string;
	escrowAddress: string;
	tokenAddress: typeof SOLANA_DEVNET_USDC_MINT;
	tokenSymbol: "USDC";
	feeTreasury: string;
	feeBps: number;
	explorerUrl: typeof SOLANA_DEVNET_EXPLORER_URL;
	networkDomain: Uint8Array;
};

export function solanaDevnetConfigFromEnv(
	env: Record<string, string | undefined>,
): SolanaNetworkConfig {
	const programId = env.PASINPAY_SOLANA_DEVNET_PROGRAM_ID ?? "";
	const feeTreasury = env.PASINPAY_SOLANA_DEVNET_FEE_TREASURY ?? "";
	const feeBps = Number(env.PASINPAY_FEE_BPS?.trim() || 250);
	if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 500) {
		throw new Error(
			`Platform fee must be an integer between 0 and 500 bps: ${feeBps}`,
		);
	}
	if (programId) address(programId);
	if (feeTreasury) address(feeTreasury);
	return {
		id: SOLANA_DEVNET_ID,
		name: SOLANA_DEVNET_NAME,
		rpcUrl: env.PASINPAY_SOLANA_DEVNET_RPC_URL || SOLANA_DEVNET_RPC_URL,
		programId,
		escrowAddress: programId,
		tokenAddress: SOLANA_DEVNET_USDC_MINT,
		tokenSymbol: "USDC",
		feeTreasury,
		feeBps,
		explorerUrl: SOLANA_DEVNET_EXPLORER_URL,
		networkDomain: SOLANA_DEVNET_NETWORK_DOMAIN,
	};
}

export function solanaExplorerTransactionUrl(signature: string) {
	return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=devnet`;
}

export function solanaExplorerAddressUrl(value: string) {
	return `https://explorer.solana.com/address/${encodeURIComponent(value)}?cluster=devnet`;
}
