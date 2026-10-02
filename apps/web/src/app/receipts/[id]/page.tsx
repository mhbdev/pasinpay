"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import {
	ExternalLink,
	GitCommitHorizontal,
	GitPullRequest,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { UsdAmount } from "@/components/usd-amount";
import { trpc } from "@/utils/trpc";

export default function ReceiptPage() {
	const { id } = useParams<{ id: string }>();
	const { data: bounty, isLoading } = useQuery(
		trpc.bounties.getById.queryOptions({ id }),
	);
	const { data: claim } = useQuery(
		trpc.bounties.claim.queryOptions({ bountyId: id }),
	);
	if (isLoading)
		return (
			<main className="mx-auto max-w-3xl px-5 py-16 text-muted-foreground">
				Loading receipt…
			</main>
		);
	if (!bounty)
		return (
			<main className="mx-auto max-w-3xl px-5 py-16">Receipt not found.</main>
		);
	const evidence = claim?.evidence as { commitHash?: string } | undefined;
	const transactionHash = bounty.settlement?.transactionHash;
	return (
		<main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-5 py-16">
			<div>
				<div className="flex size-12 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
					<ShieldCheck className="size-6" />
				</div>
				<h1 className="mt-6 font-semibold text-4xl tracking-tight">
					Work shipped.
					<br />
					Payment settled.
				</h1>
				<p className="mt-3 text-muted-foreground">
					A public receipt connecting the merged code to its USDG settlement.
				</p>
			</div>
			<Card>
				<CardHeader className="gap-4 border-b">
					<CardTitle className="text-4xl tracking-tight">
						<UsdAmount amount={bounty.amount} />
					</CardTitle>
					<p className="text-muted-foreground text-sm">
						Paid to{" "}
						{bounty.claimantWallet
							? `${bounty.claimantWallet.slice(0, 8)}…${bounty.claimantWallet.slice(-6)}`
							: "verified claimant"}
					</p>
				</CardHeader>
				<CardContent className="grid gap-6 pt-6 sm:grid-cols-2">
					<div>
						<p className="text-muted-foreground text-xs">GITHUB</p>
						<p className="mt-1 flex items-center gap-2 font-medium">
							<GitPullRequest className="size-4" /> PR #
							{claim?.githubPrNumber ?? "—"}
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">COMMIT</p>
						<p className="mt-1 flex items-center gap-2 font-mono text-xs">
							<GitCommitHorizontal className="size-4" />{" "}
							{evidence?.commitHash?.slice(0, 12) ??
								claim?.mergeCommitSha?.slice(0, 12) ??
								"—"}
							…
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">VERIFIED BY</p>
						<p className="mt-1 font-medium">PasinPay Attestor</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">NETWORK</p>
						<p className="mt-1 font-medium">Arbitrum Sepolia</p>
					</div>
				</CardContent>
			</Card>
			<div className="flex flex-wrap gap-3">
				<Button
					render={
						<a
							href={
								transactionHash
									? `https://sepolia.arbiscan.io/tx/${transactionHash}`
									: "https://sepolia.arbiscan.io"
							}
							target="_blank"
							rel="noreferrer"
						/>
					}
				>
					View on Arbiscan <ExternalLink data-icon="inline-end" />
				</Button>
				<Button
					variant="outline"
					render={<Link href={`/bounties/${bounty.id}`} />}
				>
					Back to bounty
				</Button>
			</div>
		</main>
	);
}
