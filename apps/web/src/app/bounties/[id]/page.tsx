"use client";

import { escrowAbi } from "@pasinpay/chain";
import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import {
	ArrowUpRight,
	Check,
	Clock3,
	ExternalLink,
	GitPullRequest,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { UsdAmount } from "@/components/usd-amount";
import { webChainConfig } from "@/lib/wallet";
import { trpc } from "@/utils/trpc";

const statusLabels: Record<string, string> = {
	Open: "OPEN",
	Funded: "FUNDED",
	ClaimPending: "PAYMENT READY",
	Paid: "PAID",
	Disputed: "DISPUTED",
	Refunded: "REFUNDED",
	Cancelled: "CANCELLED",
};

export default function BountyDetailPage() {
	const params = useParams<{ id: string }>();
	const id = params.id;
	const { data: bounty, isLoading } = useQuery(
		trpc.bounties.getById.queryOptions({ id }),
	);
	const { data: claim } = useQuery(
		trpc.bounties.claim.queryOptions({ bountyId: id }),
	);
	const { address } = useAccount();
	const client = usePublicClient();
	const { writeContractAsync } = useWriteContract();
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function call(
		functionName: "submitClaim" | "approveClaim" | "finalizeClaim",
	) {
		if (!bounty?.onchainBountyId || !client || !address) return;
		setBusy(functionName);
		setError(null);
		try {
			if (functionName === "submitClaim") {
				if (!claim)
					throw new Error("The verified attestation is not ready yet.");
				const evidence = claim.evidence as {
					prNumber?: number;
					commitHash?: string;
				};
				const commitHash =
					`0x${(evidence.commitHash ?? claim.mergeCommitSha).padStart(64, "0")}` as `0x${string}`;
				await writeContractAsync({
					address: webChainConfig.escrowAddress,
					abi: escrowAbi,
					functionName,
					args: [
						BigInt(bounty.onchainBountyId),
						address,
						BigInt(evidence.prNumber ?? claim.githubPrNumber),
						commitHash,
						BigInt(
							Math.floor(new Date(claim.attestationExpiresAt).getTime() / 1000),
						),
						BigInt(claim.attestationNonce),
						claim.attestationSignature as `0x${string}`,
					],
				});
			} else {
				await writeContractAsync({
					address: webChainConfig.escrowAddress,
					abi: escrowAbi,
					functionName,
					args: [BigInt(bounty.onchainBountyId)],
				});
			}
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Transaction failed");
		} finally {
			setBusy(null);
		}
	}

	if (isLoading)
		return (
			<main className="mx-auto max-w-6xl px-5 py-16 text-muted-foreground text-sm">
				Loading bounty…
			</main>
		);
	if (!bounty)
		return (
			<main className="mx-auto max-w-6xl px-5 py-16">
				<h1 className="font-semibold text-2xl">Bounty not found</h1>
				<Link className="mt-4 inline-block underline" href="/bounties">
					Back to bounties
				</Link>
			</main>
		);
	const status = statusLabels[bounty.status] ?? bounty.status.toUpperCase();
	const steps = [
		"Bounty created",
		"USDG funded",
		"PR opened",
		"PR merged",
		"Evidence verified",
	];
	const completed =
		bounty.status === "Open"
			? 1
			: bounty.status === "Funded"
				? 2
				: bounty.status === "ClaimPending"
					? 5
					: 5;
	return (
		<main className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[1fr_360px]">
			<div className="flex flex-col gap-8">
				<div>
					<div className="flex flex-wrap items-center gap-3 text-muted-foreground text-sm">
						<Link className="hover:text-foreground" href="/bounties">
							Bounties
						</Link>
						<span>/</span>
						<span>{bounty.repository}</span>
					</div>
					<div className="mt-5 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
						<div>
							<h1 className="font-semibold text-4xl tracking-tight">
								{bounty.title}
							</h1>
							<p className="mt-2 text-muted-foreground">
								Issue #{bounty.issueNumber} · {bounty.repository}
							</p>
						</div>
						<div className="rounded-full border bg-muted/40 px-3 py-1.5 font-medium text-xs">
							{status}
						</div>
					</div>
				</div>
				<Card>
					<CardHeader className="border-b">
						<CardTitle className="text-base">Progress</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-5 pt-6">
						{steps.map((step, index) => (
							<div className="flex items-center gap-3 text-sm" key={step}>
								<span
									className={`flex size-6 items-center justify-center rounded-full ${index < completed ? "bg-foreground text-background" : "border text-muted-foreground"}`}
								>
									{index < completed ? (
										<Check className="size-3.5" />
									) : (
										index + 1
									)}
								</span>
								<span
									className={
										index < completed ? "font-medium" : "text-muted-foreground"
									}
								>
									{step}
								</span>
								{index === completed - 1 && (
									<span className="ml-auto text-muted-foreground text-xs">
										current
									</span>
								)}
							</div>
						))}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="border-b">
						<CardTitle className="flex items-center gap-2 text-base">
							<ShieldCheck className="size-4" /> Verified proof
						</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-5 pt-6 text-sm sm:grid-cols-2">
						<div>
							<p className="text-muted-foreground text-xs">PULL REQUEST</p>
							<p className="mt-1 font-medium">
								{claim ? `PR #${claim.githubPrNumber}` : "Waiting for merge"}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">MERGE COMMIT</p>
							<p className="mt-1 font-mono text-xs">
								{claim?.mergeCommitSha
									? `${claim.mergeCommitSha.slice(0, 10)}…`
									: "—"}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">REPOSITORY</p>
							<p className="mt-1 font-medium">{bounty.repository}</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">NETWORK</p>
							<p className="mt-1 font-medium">Arbitrum Sepolia</p>
						</div>
					</CardContent>
				</Card>
			</div>
			<aside className="flex flex-col gap-5 lg:sticky lg:top-8 lg:h-fit">
				<Card className="overflow-hidden">
					<CardHeader className="gap-4 border-b">
						<p className="text-muted-foreground text-xs">BOUNTY REWARD</p>
						<div className="font-semibold text-4xl tracking-tight">
							<UsdAmount amount={bounty.amount} />
						</div>
						<p className="text-muted-foreground text-sm">
							Deadline {new Date(bounty.deadline).toLocaleDateString()}
						</p>
					</CardHeader>
					<CardContent className="flex flex-col gap-3 pt-6">
						{bounty.status === "ClaimPending" && claim && (
							<Button
								disabled={Boolean(busy)}
								onClick={() => call("submitClaim")}
							>
								{busy === "submitClaim" ? "Submitting…" : "Claim USDG"}
								<ArrowUpRight data-icon="inline-end" />
							</Button>
						)}
						{bounty.status === "ClaimPending" && (
							<Button
								variant="outline"
								disabled={Boolean(busy)}
								onClick={() => call("approveClaim")}
							>
								{busy === "approveClaim" ? "Approving…" : "Approve claim"}
							</Button>
						)}
						{bounty.status === "ClaimPending" && (
							<Button
								variant="outline"
								disabled={Boolean(busy)}
								onClick={() => call("finalizeClaim")}
							>
								{busy === "finalizeClaim"
									? "Finalizing…"
									: "Finalize after review"}
							</Button>
						)}
						{bounty.status === "Paid" && (
							<Button render={<Link href={`/receipts/${bounty.id}`} />}>
								View settlement <ExternalLink data-icon="inline-end" />
							</Button>
						)}
						{error && <p className="text-destructive text-sm">{error}</p>}
						<p className="flex items-center gap-2 border-t pt-4 text-muted-foreground text-xs">
							<Clock3 className="size-3.5" /> Creator approval and review
							required
						</p>
					</CardContent>
				</Card>
				<Card>
					<CardContent className="flex flex-col gap-3 pt-6 text-sm">
						<p className="flex items-center gap-2 font-medium">
							<GitPullRequest className="size-4" /> How to claim
						</p>
						<p className="text-muted-foreground leading-6">
							Open a PR with{" "}
							<span className="font-mono text-xs">
								[PasinPay #{bounty.issueNumber}]
							</span>{" "}
							in the title. Once merged, PasinPay verifies the evidence.
						</p>
					</CardContent>
				</Card>
			</aside>
		</main>
	);
}
