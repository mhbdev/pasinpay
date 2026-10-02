import { type Address, getAddress, type PublicClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";

import type { ChainConfig } from "./types";

export const ARBITRUM_SEPOLIA_ID = 421614;
export const ARBITRUM_ID = 42161;
export const SUPPORTED_ARBITRUM_CHAIN_IDS = [
	ARBITRUM_SEPOLIA_ID,
	ARBITRUM_ID,
] as const;
export const USDG_ARBITRUM_SEPOLIA: Address = getAddress(
	"0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
);
export const USDG_ARBITRUM_MAINNET: Address = getAddress(
	"0x004B506865409877C9fA29bfb1ebA929984B9bbC",
);

export const DEFAULT_CHAIN_CONFIG: ChainConfig = {
	id: ARBITRUM_SEPOLIA_ID,
	name: "Arbitrum Sepolia",
	escrowAddress: "0x0000000000000000000000000000000000000000",
	usdgAddress: USDG_ARBITRUM_SEPOLIA,
	explorerUrl: "https://sepolia.arbiscan.io",
};

export const ARBITRUM_MAINNET_CONFIG: ChainConfig = {
	id: ARBITRUM_ID,
	name: "Arbitrum One",
	escrowAddress: "0x0000000000000000000000000000000000000000",
	usdgAddress: USDG_ARBITRUM_MAINNET,
	explorerUrl: "https://arbiscan.io",
};

export const chains = {
	[arbitrumSepolia.id]: arbitrumSepolia,
	[arbitrum.id]: arbitrum,
} as const;

export { arbitrum, arbitrumSepolia };

export function chainConfigFromEnv(
	env: Record<string, string | undefined>,
): ChainConfig {
	const id = Number(env.PASINPAY_CHAIN_ID ?? ARBITRUM_SEPOLIA_ID);
	if (
		!SUPPORTED_ARBITRUM_CHAIN_IDS.includes(
			id as (typeof SUPPORTED_ARBITRUM_CHAIN_IDS)[number],
		)
	) {
		throw new Error(`Unsupported Arbitrum chain ID: ${id}`);
	}
	const isSepolia = id === ARBITRUM_SEPOLIA_ID;
	const defaultToken = isSepolia
		? USDG_ARBITRUM_SEPOLIA
		: USDG_ARBITRUM_MAINNET;
	const configuredEscrow = isSepolia
		? (env.PASINPAY_SEPOLIA_ESCROW_ADDRESS ?? env.PASINPAY_ESCROW_ADDRESS)
		: (env.PASINPAY_MAINNET_ESCROW_ADDRESS ?? env.PASINPAY_ESCROW_ADDRESS);
	return {
		id,
		name: isSepolia ? "Arbitrum Sepolia" : "Arbitrum One",
		escrowAddress: getAddress(
			configuredEscrow ?? "0x0000000000000000000000000000000000000000",
		),
		usdgAddress: getAddress(
			(isSepolia
				? env.PASINPAY_SEPOLIA_USDG_ADDRESS
				: env.PASINPAY_MAINNET_USDG_ADDRESS) ??
				env.PASINPAY_USDG_ADDRESS ??
				defaultToken,
		),
		explorerUrl: isSepolia
			? "https://sepolia.arbiscan.io"
			: "https://arbiscan.io",
		rpcUrl: env.PASINPAY_RPC_URL,
	};
}

export const erc20MetadataAbi = [
	{
		type: "function",
		name: "decimals",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "uint8" }],
	},
	{
		type: "function",
		name: "symbol",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "string" }],
	},
	{
		type: "function",
		name: "name",
		stateMutability: "view",
		inputs: [],
		outputs: [{ type: "string" }],
	},
] as const;

export async function assertUsdGToken(
	publicClient: PublicClient,
	config: ChainConfig,
) {
	const [symbol, decimals] = await Promise.all([
		publicClient.readContract({
			address: config.usdgAddress,
			abi: erc20MetadataAbi,
			functionName: "symbol",
		}),
		publicClient.readContract({
			address: config.usdgAddress,
			abi: erc20MetadataAbi,
			functionName: "decimals",
		}),
	]);
	if (symbol !== "USDG")
		throw new Error(`Configured token is ${symbol}, expected USDG`);
	return { symbol, decimals };
}
