"use client";

import { Button } from "@pasinpay/ui/components/button";
import { Wallet } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { activeChain } from "@/lib/wallet";

function shortAddress(address: string) {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
	const { address, isConnected } = useAccount();
	const { connect, connectors, isPending } = useConnect();
	const { disconnect } = useDisconnect();
	if (isConnected && address) {
		return (
			<Button variant="outline" size="sm" onClick={() => disconnect()}>
				{shortAddress(address)}
			</Button>
		);
	}

	const connector = connectors[0];
	return (
		<Button
			size="sm"
			disabled={isPending || !connector}
			onClick={() =>
				connector && connect({ connector, chainId: activeChain.id })
			}
		>
			<Wallet data-icon="inline-start" />
			{isPending ? "Connecting…" : "Connect wallet"}
		</Button>
	);
}

export function NetworkButton() {
	const { chainId } = useAccount();
	const { switchChain } = useSwitchChain();
	if (chainId === activeChain.id) return null;
	return (
		<Button
			variant="outline"
			size="sm"
			onClick={() => switchChain({ chainId: activeChain.id })}
		>
			Switch to {activeChain.name}
		</Button>
	);
}
