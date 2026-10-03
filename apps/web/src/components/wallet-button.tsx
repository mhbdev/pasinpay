"use client";

import { Button } from "@pasinpay/ui/components/button";
import { Wallet } from "lucide-react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { useAppNetwork } from "./network-provider";

function shortAddress(address: string) {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
	const { address, isConnected } = useAccount();
	const { connect, connectors, isPending } = useConnect();
	const { disconnect } = useDisconnect();
	const { chainId: walletChainId } = useAccount();
	const { switchChain } = useSwitchChain();
	const { chainConfig } = useAppNetwork();
	if (isConnected && address) {
		if (walletChainId !== chainConfig.id) {
			return (
				<Button
					variant="outline"
					size="sm"
					onClick={() => switchChain({ chainId: chainConfig.id })}
				>
					Switch to {chainConfig.name}
				</Button>
			);
		}
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
				connector && connect({ connector, chainId: chainConfig.id })
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
	const { chainConfig } = useAppNetwork();
	if (chainId === chainConfig.id) return null;
	return (
		<Button
			variant="outline"
			size="sm"
			onClick={() => switchChain({ chainId: chainConfig.id })}
		>
			Switch to {chainConfig.name}
		</Button>
	);
}
