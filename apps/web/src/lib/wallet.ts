import {
	ARBITRUM_ID,
	ARBITRUM_MAINNET_CONFIG,
	ARBITRUM_SEPOLIA_ID,
	ARC_MAINNET_CONFIG,
	ARC_MAINNET_ID,
	ARC_TESTNET_CONFIG,
	ARC_TESTNET_ID,
	arbitrum,
	arbitrumSepolia,
	arc,
	arcTestnet,
	type ChainConfig,
	DEFAULT_CHAIN_CONFIG,
	SUPPORTED_CHAIN_IDS,
} from "@pasinpay/chain";
import { http } from "viem";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

function configuredAddress(
	value: string | undefined,
	fallback: `0x${string}` = zeroAddress,
) {
	return (value ?? fallback) as `0x${string}`;
}

export type WebChainId = (typeof SUPPORTED_CHAIN_IDS)[number];

export const webChainConfigs: Record<WebChainId, ChainConfig> = {
	[ARBITRUM_SEPOLIA_ID]: {
		...DEFAULT_CHAIN_CONFIG,
		escrowAddress: configuredAddress(
			process.env.NEXT_PUBLIC_SEPOLIA_ESCROW_ADDRESS ??
				process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
			DEFAULT_CHAIN_CONFIG.escrowAddress,
		),
		tokenAddress: configuredAddress(
			process.env.NEXT_PUBLIC_SEPOLIA_USDG_ADDRESS ??
				process.env.NEXT_PUBLIC_USDG_ADDRESS,
			DEFAULT_CHAIN_CONFIG.tokenAddress,
		),
		feeTreasury: configuredAddress(
			process.env.NEXT_PUBLIC_FEE_TREASURY_ADDRESS,
		),
	},
	[ARBITRUM_ID]: {
		...ARBITRUM_MAINNET_CONFIG,
		escrowAddress: configuredAddress(
			process.env.NEXT_PUBLIC_MAINNET_ESCROW_ADDRESS,
		),
		tokenAddress: configuredAddress(
			process.env.NEXT_PUBLIC_MAINNET_USDG_ADDRESS,
			ARBITRUM_MAINNET_CONFIG.tokenAddress,
		),
		feeTreasury: configuredAddress(
			process.env.NEXT_PUBLIC_FEE_TREASURY_ADDRESS,
		),
	},
	[ARC_TESTNET_ID]: {
		...ARC_TESTNET_CONFIG,
		escrowAddress: configuredAddress(
			process.env.NEXT_PUBLIC_ARC_TESTNET_ESCROW_ADDRESS,
			ARC_TESTNET_CONFIG.escrowAddress,
		),
		tokenAddress: configuredAddress(
			process.env.NEXT_PUBLIC_ARC_TESTNET_USDC_ADDRESS,
			ARC_TESTNET_CONFIG.tokenAddress,
		),
		feeTreasury: configuredAddress(
			process.env.NEXT_PUBLIC_FEE_TREASURY_ADDRESS,
			ARC_TESTNET_CONFIG.feeTreasury,
		),
	},
	[ARC_MAINNET_ID]: {
		...ARC_MAINNET_CONFIG,
		escrowAddress: configuredAddress(
			process.env.NEXT_PUBLIC_ARC_MAINNET_ESCROW_ADDRESS,
		),
		tokenAddress: configuredAddress(
			process.env.NEXT_PUBLIC_ARC_MAINNET_USDC_ADDRESS,
			ARC_MAINNET_CONFIG.tokenAddress,
		),
		feeTreasury: configuredAddress(
			process.env.NEXT_PUBLIC_FEE_TREASURY_ADDRESS,
		),
	},
};

const configuredDefaultChainId = Number(
	process.env.NEXT_PUBLIC_CHAIN_ID ?? ARBITRUM_SEPOLIA_ID,
);
export const defaultWebChainId: WebChainId = SUPPORTED_CHAIN_IDS.includes(
	configuredDefaultChainId as WebChainId,
)
	? (configuredDefaultChainId as WebChainId)
	: ARBITRUM_SEPOLIA_ID;

export const walletConfig = createConfig({
	chains: [arbitrumSepolia, arbitrum, arcTestnet, arc],
	connectors: [injected()],
	transports: {
		[arbitrumSepolia.id]: http(),
		[arbitrum.id]: http(),
		[arcTestnet.id]: http(),
		[arc.id]: http(),
	},
});

export const webChainConfig = webChainConfigs[defaultWebChainId];

export function isWebChainConfigured(chainId: WebChainId) {
	return webChainConfigs[chainId].escrowAddress.toLowerCase() !== zeroAddress;
}

export const activeChain =
	walletConfig.chains.find((chain) => chain.id === defaultWebChainId) ??
	arbitrumSepolia;
