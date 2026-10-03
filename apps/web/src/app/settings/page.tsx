"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ExternalLink,
	GitBranch,
	Link2,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useAccount, useConnect, useSignMessage, useSwitchChain } from "wagmi";
import { AuthGuard } from "@/components/auth-guard";
import { authClient } from "@/lib/auth-client";
import { activeChain } from "@/lib/wallet";
import { trpc } from "@/utils/trpc";

export default function SettingsPage() {
	const { data: session } = authClient.useSession();
	const { address, chainId } = useAccount();
	const { connectAsync, connectors } = useConnect();
	const { signMessageAsync } = useSignMessage();
	const { switchChainAsync } = useSwitchChain();
	const challenge = useMutation(
		trpc.bounties.walletChallenge.mutationOptions(),
	);
	const linkWallet = useMutation(trpc.bounties.linkWallet.mutationOptions());
	const githubApp = useQuery(trpc.bounties.githubApp.queryOptions());
	const githubStatus = useQuery(trpc.bounties.githubStatus.queryOptions());
	const repositories = useQuery(trpc.bounties.repositories.queryOptions());
	const refreshRepositories = useMutation({
		...trpc.bounties.refreshRepositories.mutationOptions(),
		onSuccess: () => repositories.refetch(),
	});
	const [message, setMessage] = useState<string | null>(null);

	async function connectWallet() {
		try {
			let linkedAddress = address;
			let linkedChainId = chainId;
			if (!linkedAddress) {
				const connector = connectors[0];
				if (!connector) return setMessage("No browser wallet was detected.");
				const connection = await connectAsync({
					connector,
					chainId: activeChain.id,
				});
				linkedAddress = connection.accounts[0];
				linkedChainId = connection.chainId;
			}
			if (!linkedAddress || !linkedChainId)
				return setMessage("Connect a wallet first.");
			if (linkedChainId !== activeChain.id) {
				await switchChainAsync({ chainId: activeChain.id });
				linkedChainId = activeChain.id;
			}
			if (linkedChainId !== 421614 && linkedChainId !== 42161)
				return setMessage(
					"Switch to Arbitrum One or Arbitrum Sepolia before linking your wallet.",
				);
			const result = await challenge.mutateAsync({
				address: linkedAddress,
				chainId: linkedChainId,
			});
			const signature = await signMessageAsync({ message: result.message });
			await linkWallet.mutateAsync({
				nonce: result.nonce,
				address: linkedAddress,
				chainId: linkedChainId,
				signature,
			});
			setMessage("Wallet linked successfully.");
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Wallet linking failed.",
			);
		}
	}

	return (
		<AuthGuard>
			<main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-12">
				<div>
					<p className="text-muted-foreground text-sm">ACCOUNT</p>
					<h1 className="mt-2 font-semibold text-4xl tracking-tight">
						Settings
					</h1>
					<p className="mt-2 text-muted-foreground">
						Connect the identities PasinPay uses to verify work and route
						payment.
					</p>
				</div>
				<div className="grid gap-5">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<GitBranch className="size-4" /> GitHub
							</CardTitle>
							<CardDescription>
								GitHub identifies the contributor and gives PasinPay access to
								installed repositories.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex items-center justify-between gap-4 border-t pt-5">
							<div>
								<p className="font-medium">
									{githubStatus.data?.connected
										? session?.user?.name
										: "Not connected"}
								</p>
								<p className="text-muted-foreground text-sm">
									{githubStatus.data?.connected
										? (session?.user?.email ?? "GitHub connected")
										: "Connect GitHub to continue"}
								</p>
							</div>
							{githubStatus.data?.connected ? (
								<span className="flex items-center gap-2 text-emerald-600 text-sm">
									<ShieldCheck className="size-4" /> Connected
								</span>
							) : (
								<Button
									onClick={() =>
										authClient.signIn.social({
											provider: "github",
											callbackURL: `${window.location.origin}/settings`,
											errorCallbackURL: `${window.location.origin}/settings?authError=github`,
										})
									}
								>
									Connect GitHub
								</Button>
							)}
						</CardContent>
						<CardContent className="border-t pt-5">
							<div className="flex flex-wrap items-center gap-3">
								{githubApp.data?.installUrl && (
									<Button
										variant="outline"
										render={
											<a
												href={githubApp.data.installUrl}
												target="_blank"
												rel="noreferrer"
											/>
										}
									>
										Install GitHub App <ExternalLink data-icon="inline-end" />
									</Button>
								)}
								<Button
									variant="outline"
									onClick={() => refreshRepositories.mutate()}
									disabled={refreshRepositories.isPending}
								>
									<RefreshCw data-icon="inline-start" />
									{refreshRepositories.isPending
										? "Syncing repositories…"
										: "Sync installed repositories"}
								</Button>
							</div>
							{repositories.data && (
								<p className="mt-3 text-muted-foreground text-sm">
									{repositories.data.length} installed{" "}
									{repositories.data.length === 1
										? "repository"
										: "repositories"}{" "}
									available for bounties.
								</p>
							)}
						</CardContent>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<Link2 className="size-4" /> Wallet
							</CardTitle>
							<CardDescription>
								Sign a one-time message to associate your GitHub identity with a
								payout address.
							</CardDescription>
						</CardHeader>
						<CardContent className="flex items-center justify-between gap-4 border-t pt-5">
							<div>
								<p className="font-mono text-sm">
									{address
										? `${address.slice(0, 8)}…${address.slice(-6)}`
										: "No wallet connected"}
								</p>
								<p className="mt-1 text-muted-foreground text-sm">
									{chainId === 42161
										? "Arbitrum One"
										: chainId === 421614
											? "Arbitrum Sepolia"
											: "Network not connected"}
								</p>
							</div>
							<Button
								onClick={connectWallet}
								disabled={
									!session?.user || challenge.isPending || linkWallet.isPending
								}
							>
								{challenge.isPending || linkWallet.isPending
									? "Linking…"
									: address
										? "Link wallet"
										: "Connect & link wallet"}
							</Button>
						</CardContent>
					</Card>
				</div>
				{message && <p className="text-muted-foreground text-sm">{message}</p>}
			</main>
		</AuthGuard>
	);
}
