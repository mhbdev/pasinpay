import type { ChainConfig } from "@pasinpay/chain";
import { http } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

export const walletConfig = createConfig({
	chains: [arbitrumSepolia, arbitrum],
	connectors: [injected()],
	transports: { [arbitrumSepolia.id]: http(), [arbitrum.id]: http() },
});

export type WebChainId = typeof arbitrum.id | typeof arbitrumSepolia.id;

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

function configuredAddress(value: string | undefined) {
	return (value ?? zeroAddress) as `0x${string}`;
}

export const defaultWebChainId: WebChainId = arbitrumSepolia.id;

export const webChainConfigs: Record<WebChainId, ChainConfig> = {
	[arbitrumSepolia.id]: {
		id: arbitrumSepolia.id,
		name: "Arbitrum Sepolia",
		escrowAddress: configuredAddress(
			process.env.NEXT_PUBLIC_SEPOLIA_ESCROW_ADDRESS ??
				process.env.NEXT_PUBLIC_ESCROW_ADDRESS,
		),
		usdgAddress: configuredAddress(
			process.env.NEXT_PUBLIC_SEPOLIA_USDG_ADDRESS ??
				process.env.NEXT_PUBLIC_USDG_ADDRESS ??
				"0xFFC95faa3d63Cde504a05B567C600B78C0b41892",
		),
		explorerUrl: "https://sepolia.arbiscan.io",
	},
	[arbitrum.id]: {
		id: arbitrum.id,
		name: "Arbitrum One",
		escrowAddress: configuredAddress(
			process.env.NEXT_PUBLIC_MAINNET_ESCROW_ADDRESS,
		),
		usdgAddress: configuredAddress(
			process.env.NEXT_PUBLIC_MAINNET_USDG_ADDRESS ??
				"0x004B506865409877C9fA29bfb1ebA929984B9bbC",
		),
		explorerUrl: "https://arbiscan.io",
	},
};

export const webChainConfig = webChainConfigs[defaultWebChainId];

export const activeChain = arbitrumSepolia;
