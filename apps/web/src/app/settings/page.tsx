"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@pasinpay/ui/components/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useAppNetwork } from "@/components/network-provider";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export default function SettingsPage() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const isAuthenticated = !sessionPending && Boolean(session);
	const { address, chainId } = useAccount();
	const { chainConfig } = useAppNetwork();
	const { connectAsync, connectors } = useConnect();
	const { signMessageAsync } = useSignMessage();
	const { switchChainAsync } = useSwitchChain();
	const queryClient = useQueryClient();
	const challenge = useMutation(
		trpc.bounties.walletChallenge.mutationOptions(),
	);
	const linkWallet = useMutation(trpc.bounties.linkWallet.mutationOptions());
	const wallet = useQuery(
		trpc.bounties.walletLink.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const unlinkWallet = useMutation(
		trpc.bounties.unlinkWallet.mutationOptions(),
	);
	const githubApp = useQuery(
		trpc.bounties.githubApp.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const githubStatus = useQuery(
		trpc.bounties.githubStatus.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const repositories = useQuery(
		trpc.bounties.repositories.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const refreshRepositories = useMutation({
		...trpc.bounties.refreshRepositories.mutationOptions(),
		onSuccess: async (result) => {
			await repositories.refetch();
			setMessage(`Synced ${result.synced} installed repositories.`);
		},
		onError: (error) => setMessage(error.message),
	});
	const [message, setMessage] = useState<string | null>(null);
	const [unlinkOpen, setUnlinkOpen] = useState(false);
	const walletIsLinked = Boolean(wallet.data);

	async function connectWallet() {
		try {
			let linkedAddress = address;
			let linkedChainId = chainId;
			if (!linkedAddress) {
				const connector = connectors[0];
				if (!connector) return setMessage("No browser wallet was detected.");
				const connection = await connectAsync({
					connector,
					chainId: chainConfig.id,
				});
				linkedAddress = connection.accounts[0];
				linkedChainId = connection.chainId;
			}
			if (!linkedAddress || !linkedChainId)
				return setMessage("Connect a wallet first.");
			if (linkedChainId !== chainConfig.id) {
				await switchChainAsync({ chainId: chainConfig.id });
				linkedChainId = chainConfig.id;
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
			await queryClient.invalidateQueries({
				queryKey: trpc.bounties.walletLink.queryKey(),
			});
			setMessage("Wallet linked successfully.");
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Wallet linking failed.",
			);
		}
	}

	async function unlinkLinkedWallet() {
		try {
			await unlinkWallet.mutateAsync();
			await queryClient.invalidateQueries({
				queryKey: trpc.bounties.walletLink.queryKey(),
			});
			setUnlinkOpen(false);
			setMessage("Wallet unlinked successfully.");
		} catch (error) {
			setMessage(
				error instanceof Error ? error.message : "Wallet unlinking failed.",
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
				<div className="grid gap-6">
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
						<CardFooter className="justify-between gap-4">
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
						</CardFooter>
						<CardFooter className="flex-col items-stretch gap-3">
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
									disabled={
										refreshRepositories.isPending ||
										!githubStatus.data?.connected
									}
								>
									<RefreshCw data-icon="inline-start" />
									{refreshRepositories.isPending
										? "Syncing repositories…"
										: "Sync installed repositories"}
								</Button>
							</div>
							{repositories.data && (
								<p className="text-muted-foreground text-sm">
									{repositories.data.length} installed{" "}
									{repositories.data.length === 1
										? "repository"
										: "repositories"}{" "}
									available for bounties.
								</p>
							)}
						</CardFooter>
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
						<CardFooter className="justify-between gap-4">
							<div>
								<p className="font-mono text-sm">
									{wallet.data?.walletAddress
										? `${wallet.data.walletAddress.slice(0, 8)}…${wallet.data.walletAddress.slice(-6)}`
										: address
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
								onClick={() =>
									walletIsLinked ? setUnlinkOpen(true) : connectWallet()
								}
								disabled={
									!session?.user ||
									challenge.isPending ||
									linkWallet.isPending ||
									unlinkWallet.isPending
								}
							>
								{challenge.isPending ||
								linkWallet.isPending ||
								unlinkWallet.isPending
									? walletIsLinked
										? "Unlinking…"
										: "Linking…"
									: walletIsLinked
										? "Unlink wallet"
										: address
											? "Link wallet"
											: "Connect & link wallet"}
							</Button>
						</CardFooter>
						<Dialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Unlink wallet?</DialogTitle>
									<DialogDescription>
										This removes the payout address from your PasinPay account.
										It does not disconnect your browser wallet or move any
										escrowed funds.
									</DialogDescription>
								</DialogHeader>
								<DialogFooter>
									<DialogClose render={<Button variant="outline" />}>
										Keep wallet linked
									</DialogClose>
									<Button
										variant="destructive"
										onClick={unlinkLinkedWallet}
										disabled={unlinkWallet.isPending}
									>
										{unlinkWallet.isPending ? "Unlinking…" : "Unlink wallet"}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</Card>
				</div>
				{message && (
					<p aria-live="polite" className="text-muted-foreground text-sm">
						{message}
					</p>
				)}
			</main>
		</AuthGuard>
	);
}
