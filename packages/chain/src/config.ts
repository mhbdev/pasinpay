import { type Address, defineChain, getAddress, type PublicClient } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";

import { escrowAbi } from "./abi";
import type { ChainConfig } from "./types";

export const ARBITRUM_SEPOLIA_ID = 421614;
export const ARBITRUM_ID = 42161;
export const ARC_TESTNET_ID = 5042002;
export const ARC_MAINNET_ID = 5042;
export const SUPPORTED_CHAIN_IDS = [
	ARBITRUM_SEPOLIA_ID,
	ARBITRUM_ID,
	ARC_TESTNET_ID,
	ARC_MAINNET_ID,
] as const;
/** @deprecated Use SUPPORTED_CHAIN_IDS. */
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
export const ARC_USDC: Address = getAddress(
	"0x3600000000000000000000000000000000000000",
);
export const PASINPAY_ESCROW_ARBITRUM_SEPOLIA: Address = getAddress(
	"0x3591645C5DBfa67FC18B32b3f13d65f22d87d75D",
);
export const PASINPAY_ESCROW_ARC_TESTNET: Address = getAddress(
	"0x1bc0ace2be823c5c94df45dd6ee7d20624f03d21",
);
export const PASINPAY_FEE_TREASURY_TESTNET: Address = getAddress(
	"0xBeB255445aCbF22d79C4b464A7A0e0B733969d2c",
);
export const ZERO_ADDRESS: Address =
	"0x0000000000000000000000000000000000000000";

export const arc = defineChain({
	id: ARC_MAINNET_ID,
	name: "Arc",
	nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
	rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
	blockExplorers: {
		default: { name: "Arc Explorer", url: "https://explorer.arc.io" },
	},
});

export const arcTestnet = defineChain({
	id: ARC_TESTNET_ID,
	name: "Arc Testnet",
	nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
	rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
	blockExplorers: {
		default: {
			name: "Arc Testnet Explorer",
			url: "https://explorer.testnet.arc.io",
		},
	},
});

const arbitrumSepoliaConfig: ChainConfig = {
	id: ARBITRUM_SEPOLIA_ID,
	name: "Arbitrum Sepolia",
	escrowAddress: PASINPAY_ESCROW_ARBITRUM_SEPOLIA,
	tokenAddress: USDG_ARBITRUM_SEPOLIA,
	tokenSymbol: "USDG",
	tokenEip712Name: "Global Dollar",
	tokenEip712Version: "1",
	feeTreasury: ZERO_ADDRESS,
	feeBps: 250,
	explorerUrl: "https://sepolia.arbiscan.io",
};

export const DEFAULT_CHAIN_CONFIG = arbitrumSepoliaConfig;

export const ARBITRUM_MAINNET_CONFIG: ChainConfig = {
	id: ARBITRUM_ID,
	name: "Arbitrum One",
	escrowAddress: ZERO_ADDRESS,
	tokenAddress: USDG_ARBITRUM_MAINNET,
	tokenSymbol: "USDG",
	tokenEip712Name: "Global Dollar",
	tokenEip712Version: "1",
	feeTreasury: ZERO_ADDRESS,
	feeBps: 250,
	explorerUrl: "https://arbiscan.io",
};

export const ARC_TESTNET_CONFIG: ChainConfig = {
	id: ARC_TESTNET_ID,
	name: "Arc Testnet",
	escrowAddress: PASINPAY_ESCROW_ARC_TESTNET,
	tokenAddress: ARC_USDC,
	tokenSymbol: "USDC",
	tokenEip712Name: "USDC",
	tokenEip712Version: "2",
	feeTreasury: PASINPAY_FEE_TREASURY_TESTNET,
	feeBps: 250,
	explorerUrl: "https://explorer.testnet.arc.io",
	rpcUrl: "https://rpc.testnet.arc.io",
};

export const ARC_MAINNET_CONFIG: ChainConfig = {
	id: ARC_MAINNET_ID,
	name: "Arc",
	escrowAddress: ZERO_ADDRESS,
	tokenAddress: ARC_USDC,
	tokenSymbol: "USDC",
	tokenEip712Name: "USDC",
	tokenEip712Version: "2",
	feeTreasury: ZERO_ADDRESS,
	feeBps: 250,
	explorerUrl: "https://explorer.arc.io",
	rpcUrl: "https://rpc.mainnet.arc.io",
};

export const chainConfigs: Record<
	(typeof SUPPORTED_CHAIN_IDS)[number],
	ChainConfig
> = {
	[ARBITRUM_SEPOLIA_ID]: arbitrumSepoliaConfig,
	[ARBITRUM_ID]: ARBITRUM_MAINNET_CONFIG,
	[ARC_TESTNET_ID]: ARC_TESTNET_CONFIG,
	[ARC_MAINNET_ID]: ARC_MAINNET_CONFIG,
};

export const chains = {
	[arbitrumSepolia.id]: arbitrumSepolia,
	[arbitrum.id]: arbitrum,
	[arcTestnet.id]: arcTestnet,
	[arc.id]: arc,
} as const;

export { arbitrum, arbitrumSepolia };

export function chainConfigFromEnv(
	env: Record<string, string | undefined>,
): ChainConfig {
	const id = Number(env.PASINPAY_CHAIN_ID ?? ARBITRUM_SEPOLIA_ID);
	if (
		!SUPPORTED_CHAIN_IDS.includes(id as (typeof SUPPORTED_CHAIN_IDS)[number])
	) {
		throw new Error(`Unsupported chain ID: ${id}`);
	}
	const base = chainConfigs[id as keyof typeof chainConfigs];
	const feeBps = Number(env.PASINPAY_FEE_BPS ?? 250);
	if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 500) {
		throw new Error(
			`Platform fee must be an integer between 0 and 500 bps: ${feeBps}`,
		);
	}
	const prefix = {
		[ARBITRUM_SEPOLIA_ID]: "SEPOLIA",
		[ARBITRUM_ID]: "MAINNET",
		[ARC_TESTNET_ID]: "ARC_TESTNET",
		[ARC_MAINNET_ID]: "ARC_MAINNET",
	}[id as keyof typeof chainConfigs];
	const tokenAddress =
		env[`PASINPAY_${prefix}_TOKEN_ADDRESS`] ??
		(id === ARBITRUM_SEPOLIA_ID
			? env.PASINPAY_SEPOLIA_USDG_ADDRESS
			: undefined) ??
		(id === ARBITRUM_ID ? env.PASINPAY_MAINNET_USDG_ADDRESS : undefined) ??
		(env.PASINPAY_TOKEN_ADDRESS || undefined) ??
		(id === ARBITRUM_ID || id === ARBITRUM_SEPOLIA_ID
			? env.PASINPAY_USDG_ADDRESS
			: undefined) ??
		base.tokenAddress;
	const escrowAddress =
		env[`PASINPAY_${prefix}_ESCROW_ADDRESS`] ??
		env.PASINPAY_ESCROW_ADDRESS ??
		base.escrowAddress;
	return {
		...base,
		escrowAddress: getAddress(escrowAddress),
		tokenAddress: getAddress(tokenAddress),
		feeTreasury: getAddress(
			env.PASINPAY_FEE_TREASURY_ADDRESS ?? base.feeTreasury,
		),
		feeBps,
		rpcUrl: env.PASINPAY_RPC_URL || base.rpcUrl,
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

const eip3009AuthorizationStateAbi = [
	{
		type: "function",
		name: "authorizationState",
		stateMutability: "view",
		inputs: [
			{ name: "authorizer", type: "address" },
			{ name: "nonce", type: "bytes32" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;

export async function supportsX402Funding(
	publicClient: PublicClient,
	config: ChainConfig,
) {
	const zeroNonce = `0x${"0".repeat(64)}` as `0x${string}`;
	try {
		await Promise.all([
			publicClient.readContract({
				address: config.escrowAddress,
				abi: escrowAbi,
				functionName: "usedX402Nonces",
				args: [ZERO_ADDRESS, zeroNonce],
			}),
			publicClient.readContract({
				address: config.tokenAddress,
				abi: eip3009AuthorizationStateAbi,
				functionName: "authorizationState",
				args: [ZERO_ADDRESS, zeroNonce],
			}),
		]);
		return true;
	} catch {
		return false;
	}
}

export async function assertConfiguredToken(
	publicClient: PublicClient,
	config: ChainConfig,
) {
	const [symbol, decimals] = await Promise.all([
		publicClient.readContract({
			address: config.tokenAddress,
			abi: erc20MetadataAbi,
			functionName: "symbol",
		}),
		publicClient.readContract({
			address: config.tokenAddress,
			abi: erc20MetadataAbi,
			functionName: "decimals",
		}),
	]);
	if (symbol !== config.tokenSymbol) {
		throw new Error(
			`Configured token is ${symbol}, expected ${config.tokenSymbol}`,
		);
	}
	if (config.id === ARC_MAINNET_ID || config.id === ARC_TESTNET_ID) {
		if (decimals !== 6)
			throw new Error(
				`Arc USDC must use 6 ERC-20 decimals, received ${decimals}`,
			);
	}
	return { symbol, decimals };
}

/** @deprecated Use assertConfiguredToken. */
export const assertUsdGToken = assertConfiguredToken;
