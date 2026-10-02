"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { useMutation } from "@tanstack/react-query";
import { GitBranch, Link2, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { AuthGuard } from "@/components/auth-guard";
import { authClient } from "@/lib/auth-client";
import { trpc } from "@/utils/trpc";

export default function SettingsPage() {
	const { data: session } = authClient.useSession();
	const { address, chainId } = useAccount();
	const { signMessageAsync } = useSignMessage();
	const challenge = useMutation(
		trpc.bounties.walletChallenge.mutationOptions(),
	);
	const linkWallet = useMutation(trpc.bounties.linkWallet.mutationOptions());
	const [message, setMessage] = useState<string | null>(null);

	async function connectWallet() {
		if (!address || !chainId) return setMessage("Connect a wallet first.");
		if (chainId !== 421614 && chainId !== 42161)
			return setMessage(
				"Switch to Arbitrum One or Arbitrum Sepolia before linking your wallet.",
			);
		try {
			const result = await challenge.mutateAsync({ address, chainId });
			const signature = await signMessageAsync({ message: result.message });
			await linkWallet.mutateAsync({
				nonce: result.nonce,
				address,
				chainId,
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
									{session?.user ? session.user.name : "Not connected"}
								</p>
								<p className="text-muted-foreground text-sm">
									{session?.user?.email ?? "Connect GitHub to continue"}
								</p>
							</div>
							{session?.user ? (
								<span className="flex items-center gap-2 text-emerald-600 text-sm">
									<ShieldCheck className="size-4" /> Connected
								</span>
							) : (
								<Button
									onClick={() =>
										authClient.signIn.social({
											provider: "github",
											callbackURL: "/settings",
										})
									}
								>
									Connect GitHub
								</Button>
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
									{chainId === 42161 ? "Arbitrum One" : "Arbitrum Sepolia"}
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
									: "Link wallet"}
							</Button>
						</CardContent>
					</Card>
				</div>
				{message && <p className="text-muted-foreground text-sm">{message}</p>}
			</main>
		</AuthGuard>
	);
}
