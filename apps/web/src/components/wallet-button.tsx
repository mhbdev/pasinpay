"use client";

import { SOLANA_DEVNET_ID } from "@pasinpay/solana";
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
import {
	useConnectedWallet,
	useConnect as useSolanaConnect,
	useDisconnect as useSolanaDisconnect,
	useWallets,
} from "@solana/kit-plugin-wallet/react";
import { Wallet } from "lucide-react";
import { useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { solanaClient } from "@/lib/solana-client";

import { useAppNetwork } from "./network-provider";

function shortAddress(address: string) {
	return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletButton() {
	const { networkId } = useAppNetwork();
	return networkId === SOLANA_DEVNET_ID ? (
		<SolanaWalletButton />
	) : (
		<EvmWalletButton />
	);
}

function EvmWalletButton() {
	const [disconnectOpen, setDisconnectOpen] = useState(false);
	const { address, connector: activeConnector, isConnected } = useAccount();
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
								disconnect({ connector: activeConnector });
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
	const { networkId } = useAppNetwork();
	return networkId === SOLANA_DEVNET_ID ? (
		<SolanaWalletMenuAction onDisconnectRequest={onDisconnectRequest} />
	) : (
		<EvmWalletMenuAction onDisconnectRequest={onDisconnectRequest} />
	);
}

function EvmWalletMenuAction({
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

function SolanaWalletButton() {
	const [disconnectOpen, setDisconnectOpen] = useState(false);
	const connected = useConnectedWallet(solanaClient);
	const wallets = useWallets(solanaClient);
	const connect = useSolanaConnect(solanaClient);
	const disconnect = useSolanaDisconnect(solanaClient);
	if (connected) {
		return (
			<Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
				<DialogTrigger render={<Button variant="outline" size="sm" />}>
					{shortAddress(connected.account.address)}
				</DialogTrigger>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Disconnect Solana wallet?</DialogTitle>
						<DialogDescription>
							This disconnects the wallet from this browser session. Its
							PasinPay wallet link and any escrowed funds are unchanged.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose
							render={<Button variant="outline">Keep connected</Button>}
						/>
						<Button
							variant="destructive"
							onClick={() => {
								void disconnect.dispatchAsync();
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
	const wallet = wallets[0];
	return (
		<Button
			size="sm"
			disabled={connect.isRunning || !wallet}
			onClick={() => wallet && void connect.dispatchAsync(wallet)}
		>
			<Wallet data-icon="inline-start" />
			{connect.isRunning
				? "Connecting…"
				: wallet
					? `Connect ${wallet.name}`
					: "Install a Solana wallet"}
		</Button>
	);
}

function SolanaWalletMenuAction({
	onDisconnectRequest,
}: {
	onDisconnectRequest: () => void;
}) {
	const connected = useConnectedWallet(solanaClient);
	const wallets = useWallets(solanaClient);
	const connect = useSolanaConnect(solanaClient);
	if (!connected) {
		const wallet = wallets[0];
		return (
			<DropdownMenuItem
				disabled={connect.isRunning || !wallet}
				onClick={() => wallet && void connect.dispatchAsync(wallet)}
			>
				<Wallet />
				{connect.isRunning
					? "Connecting…"
					: wallet
						? `Connect ${wallet.name}`
						: "No Solana wallet detected"}
			</DropdownMenuItem>
		);
	}
	return (
		<DropdownMenuItem onClick={onDisconnectRequest}>
			<Wallet />
			<span>Solana wallet</span>
			<span className="ml-auto font-mono text-muted-foreground text-xs">
				{shortAddress(connected.account.address)}
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
