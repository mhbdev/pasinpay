"use client";

import { Badge } from "@pasinpay/ui/components/badge";
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
import { useAppNetwork } from "@/components/network-provider";
import { UsdAmount } from "@/components/usd-amount";
import { trpc } from "@/utils/trpc";

export default function ReceiptPage() {
	const { id } = useParams<{ id: string }>();
	const { chainConfig } = useAppNetwork();
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
	const evidence = claim?.evidence as
		| {
				commitHash?: string;
				prUrl?: string;
		  }
		| undefined;
	const transactionHash = bounty.settlement?.transactionHash;
	const commitHash = evidence?.commitHash ?? claim?.mergeCommitSha;
	const pullRequestUrl =
		evidence?.prUrl ??
		(claim
			? `https://github.com/${bounty.repository}/pull/${claim.githubPrNumber}`
			: null);
	const commitUrl = commitHash
		? `https://github.com/${bounty.repository}/commit/${commitHash}`
		: null;
	const payoutUrl = bounty.claimantWallet
		? `${chainConfig.explorerUrl}/address/${bounty.claimantWallet}`
		: null;
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
						{payoutUrl ? (
							<a
								className="font-mono underline underline-offset-2 hover:text-foreground"
								href={payoutUrl}
								target="_blank"
								rel="noreferrer"
							>
								{bounty.claimantWallet?.slice(0, 8)}…
								{bounty.claimantWallet?.slice(-6)}
							</a>
						) : (
							"verified claimant"
						)}
					</p>
				</CardHeader>
				<CardContent className="grid gap-6 sm:grid-cols-2">
					<div>
						<p className="text-muted-foreground text-xs">PLATFORM FEE</p>
						<p className="mt-1 font-medium">
							<UsdAmount amount={bounty.settlement?.feeAmount ?? "0"} />
						</p>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">GITHUB</p>
						{pullRequestUrl ? (
							<a
								className="mt-1 flex items-center gap-2 font-medium underline underline-offset-2 hover:text-foreground"
								href={pullRequestUrl}
								target="_blank"
								rel="noreferrer"
							>
								<GitPullRequest data-icon="inline-start" /> PR #
								{claim?.githubPrNumber ?? "—"}
							</a>
						) : (
							<p className="mt-1 flex items-center gap-2 font-medium">
								<GitPullRequest data-icon="inline-start" /> PR #—
							</p>
						)}
					</div>
					<div>
						<p className="text-muted-foreground text-xs">COMMIT</p>
						{commitUrl ? (
							<a
								className="mt-1 flex items-center gap-2 font-mono text-xs underline underline-offset-2 hover:text-foreground"
								href={commitUrl}
								target="_blank"
								rel="noreferrer"
							>
								<GitCommitHorizontal data-icon="inline-start" />{" "}
								{commitHash?.slice(0, 12)}…
							</a>
						) : (
							<p className="mt-1 flex items-center gap-2 font-mono text-xs">
								<GitCommitHorizontal data-icon="inline-start" /> —
							</p>
						)}
					</div>
					<div>
						<p className="text-muted-foreground text-xs">VERIFIED BY</p>
						<Badge className="mt-1" variant="default">
							<ShieldCheck data-icon="inline-start" /> PasinPay Attestor
						</Badge>
					</div>
					<div>
						<p className="text-muted-foreground text-xs">NETWORK</p>
						<p className="mt-1 font-medium">{chainConfig.name}</p>
					</div>
				</CardContent>
			</Card>
			<div className="flex flex-wrap gap-3">
				<Button
					render={
						<a
							href={
								transactionHash
									? `${chainConfig.explorerUrl}/tx/${transactionHash}`
									: chainConfig.explorerUrl
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
