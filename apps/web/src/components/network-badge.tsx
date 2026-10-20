"use client";

import type { SupportedChainId } from "@pasinpay/chain";
import { Badge } from "@pasinpay/ui/components/badge";
import { webChainConfigs } from "@/lib/wallet";

export function NetworkBadge({ chainId }: { chainId: number }) {
	if (chainId === 103) {
		return (
			<Badge variant="outline" title="Solana Devnet · USDC">
				Solana Devnet · USDC
			</Badge>
		);
	}
	const config = webChainConfigs[chainId as SupportedChainId];
	if (!config) return null;
	return (
		<Badge variant="outline" title={`${config.name} · ${config.tokenSymbol}`}>
			{config.name} · {config.tokenSymbol}
		</Badge>
	);
}
