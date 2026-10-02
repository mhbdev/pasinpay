import { http } from "viem";
import { arbitrum, arbitrumSepolia } from "viem/chains";
import { createConfig } from "wagmi";
import { injected } from "wagmi/connectors";

export const walletConfig = createConfig({
	chains: [arbitrumSepolia, arbitrum],
	connectors: [injected()],
	transports: { [arbitrumSepolia.id]: http(), [arbitrum.id]: http() },
});

const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? arbitrumSepolia.id);
const isMainnet = chainId === arbitrum.id;

export const webChainConfig = {
	id: chainId,
	escrowAddress: (process.env.NEXT_PUBLIC_ESCROW_ADDRESS ??
		(isMainnet
			? process.env.NEXT_PUBLIC_MAINNET_ESCROW_ADDRESS
			: process.env.NEXT_PUBLIC_SEPOLIA_ESCROW_ADDRESS) ??
		"0x0000000000000000000000000000000000000000") as `0x${string}`,
	usdgAddress: (process.env.NEXT_PUBLIC_USDG_ADDRESS ??
		(isMainnet
			? process.env.NEXT_PUBLIC_MAINNET_USDG_ADDRESS
			: process.env.NEXT_PUBLIC_SEPOLIA_USDG_ADDRESS) ??
		(isMainnet
			? "0x004B506865409877C9fA29bfb1ebA929984B9bbC"
			: "0xFFC95faa3d63Cde504a05B567C600B78C0b41892")) as `0x${string}`,
	explorerUrl: isMainnet
		? "https://arbiscan.io"
		: "https://sepolia.arbiscan.io",
};

export const activeChain = isMainnet ? arbitrum : arbitrumSepolia;
