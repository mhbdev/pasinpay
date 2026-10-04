"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@pasinpay/ui/components/dialog";
import { DropdownMenuItem } from "@pasinpay/ui/components/dropdown-menu";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";

import { useAppNetwork } from "./network-provider";

function shortAddress(address: string) {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
	const [disconnectOpen, setDisconnectOpen] = useState(false);
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
			<Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
				<DialogTrigger render={<Button variant="outline" size="sm" />}>
					{shortAddress(address)}
				</DialogTrigger>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Disconnect wallet?</DialogTitle>
						<DialogDescription>
							Your wallet will be disconnected from this browser session. Your
							PasinPay account link remains unchanged.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Keep connected
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								disconnect();
								setDisconnectOpen(false);
							}}
						>
							Disconnect wallet
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
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

export function WalletMenuAction({
	onDisconnectRequest,
}: {
	onDisconnectRequest: () => void;
}) {
	const { address, chainId, isConnected } = useAccount();
	const { connect, connectors, isPending } = useConnect();
	const { switchChain } = useSwitchChain();
	const { chainConfig } = useAppNetwork();
	const connector = connectors[0];

	if (!isConnected || !address) {
		return (
			<DropdownMenuItem
				disabled={isPending || !connector}
				onClick={() =>
					connector && connect({ connector, chainId: chainConfig.id })
				}
			>
				<Wallet />
				{isPending ? "Connecting…" : "Connect wallet"}
			</DropdownMenuItem>
		);
	}

	if (chainId !== chainConfig.id) {
		return (
			<DropdownMenuItem
				onClick={() => switchChain({ chainId: chainConfig.id })}
			>
				<Wallet />
				Switch to {chainConfig.name}
			</DropdownMenuItem>
		);
	}

	return (
		<DropdownMenuItem onClick={onDisconnectRequest}>
			<Wallet />
			<span>Wallet</span>
			<span className="ml-auto font-mono text-muted-foreground text-xs">
				{shortAddress(address)}
			</span>
		</DropdownMenuItem>
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
