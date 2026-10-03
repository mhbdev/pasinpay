"use client";

import { escrowAbi } from "@pasinpay/chain";
import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@pasinpay/ui/components/dropdown-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowUpRight,
	Check,
	Clock3,
	ExternalLink,
	GitPullRequest,
	Share2,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import {
	useAccount,
	usePublicClient,
	useSwitchChain,
	useWriteContract,
} from "wagmi";
import { useAppNetwork } from "@/components/network-provider";
import { UsdAmount } from "@/components/usd-amount";
import { writeWithFreshEip1559Fees } from "@/lib/transaction-fees";
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
	const { address, chainId } = useAccount();
	const { chainConfig } = useAppNetwork();
	const client = usePublicClient({ chainId: chainConfig.id });
	const { switchChainAsync } = useSwitchChain();
	const { writeContractAsync } = useWriteContract();
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	async function shareBounty() {
		const url = window.location.href;
		try {
			if (navigator.share) {
				await navigator.share({
					title: bounty?.title ?? "PasinPay bounty",
					url,
				});
				return;
			}
			await navigator.clipboard.writeText(url);
			toast.success("Bounty link copied");
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === "AbortError") return;
			toast.error("Could not share this bounty");
		}
	}

	async function call(
		functionName: "submitClaim" | "approveClaim" | "finalizeClaim",
	) {
		if (!bounty?.onchainBountyId || !client || !address)
			return setError("Connect the wallet used for this bounty first.");
		const onchainBountyId = bounty.onchainBountyId;
		setBusy(functionName);
		setError(null);
		try {
			if (chainId !== chainConfig.id)
				await switchChainAsync({ chainId: chainConfig.id });
			if (
				chainConfig.escrowAddress ===
				"0x0000000000000000000000000000000000000000"
			)
				throw new Error(
					`${chainConfig.name} is available for wallet connections, but its PasinPay escrow contract has not been deployed yet.`,
				);
			if (functionName === "submitClaim") {
				if (!claim)
					throw new Error("The verified attestation is not ready yet.");
				if (claim.claimantWallet.toLowerCase() !== address.toLowerCase())
					throw new Error(
						"Only the attested claimant wallet can submit this claim.",
					);
				const evidence = claim.evidence as {
					prNumber?: number;
					commitHash?: string;
				};
				const commitHash =
					`0x${(evidence.commitHash ?? claim.mergeCommitSha).padStart(64, "0")}` as `0x${string}`;
				const hash = await writeWithFreshEip1559Fees(client, (fees) =>
					writeContractAsync({
						address: chainConfig.escrowAddress,
						abi: escrowAbi,
						functionName,
						args: [
							BigInt(onchainBountyId),
							address,
							BigInt(evidence.prNumber ?? claim.githubPrNumber),
							commitHash,
							BigInt(
								Math.floor(
									new Date(claim.attestationExpiresAt).getTime() / 1000,
								),
							),
							BigInt(claim.attestationNonce),
							claim.attestationSignature as `0x${string}`,
						],
						...fees,
					}),
				);
				await client.waitForTransactionReceipt({ hash });
			} else {
				if (bounty.creatorWallet.toLowerCase() !== address.toLowerCase())
					throw new Error(
						"Only the bounty creator can approve or finalize this claim.",
					);
				const hash = await writeWithFreshEip1559Fees(client, (fees) =>
					writeContractAsync({
						address: chainConfig.escrowAddress,
						abi: escrowAbi,
						functionName,
						args: [BigInt(onchainBountyId)],
						...fees,
					}),
				);
				await client.waitForTransactionReceipt({ hash });
			}
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: trpc.bounties.getById.queryKey({ id }),
				}),
				queryClient.invalidateQueries({
					queryKey: trpc.bounties.claim.queryKey({ bountyId: id }),
				}),
			]);
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
	const chain = bounty.chain;
	const issueUrl =
		bounty.issueUrl ||
		`https://github.com/${bounty.repository}/issues/${bounty.issueNumber}`;
	const latestClaim = bounty.claims?.[0] ?? claim;
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
					<div className="flex flex-wrap gap-2">
						<DropdownMenu>
							<DropdownMenuTrigger
								render={
									<Button size="sm" variant="outline">
										<Share2 data-icon="inline-start" /> Share
									</Button>
								}
							/>
							<DropdownMenuContent align="start">
								<DropdownMenuItem onClick={() => void shareBounty()}>
									Copy or share link
								</DropdownMenuItem>
								<DropdownMenuItem
									render={
										<a
											href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`${bounty.title} · PasinPay`)}&url=${encodeURIComponent(typeof window === "undefined" ? "" : window.location.href)}`}
											target="_blank"
											rel="noreferrer"
										/>
									}
								>
									Share on X
								</DropdownMenuItem>
								<DropdownMenuItem
									render={
										<a
											href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(typeof window === "undefined" ? "" : window.location.href)}`}
											target="_blank"
											rel="noreferrer"
										/>
									}
								>
									Share on LinkedIn
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
						<Button
							size="sm"
							variant="outline"
							render={<a href={issueUrl} target="_blank" rel="noreferrer" />}
						>
							Open GitHub issue <ExternalLink data-icon="inline-end" />
						</Button>
						<Button
							size="sm"
							variant="ghost"
							render={
								<a
									href={`https://github.com/${bounty.repository}`}
									target="_blank"
									rel="noreferrer"
								/>
							}
						>
							{bounty.repository} <ExternalLink data-icon="inline-end" />
						</Button>
					</div>
				</div>
				<Card>
					<CardHeader className="border-b">
						<CardTitle className="text-base">Bounty overview</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-5 sm:grid-cols-3">
						<div>
							<p className="text-muted-foreground text-xs">REWARD</p>
							<p className="mt-1 font-medium">
								<UsdAmount amount={bounty.amount} />
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">PLATFORM FEE</p>
							<p className="mt-1 font-medium">
								<UsdAmount amount={bounty.feeAmount} />
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">TOTAL FUNDED</p>
							<p className="mt-1 font-medium">
								<UsdAmount amount={bounty.totalFunded} />
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">PARTICIPANTS</p>
							<p className="mt-1 font-medium">{bounty.stats.participants}</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">SUBMISSIONS</p>
							<p className="mt-1 font-medium">{bounty.stats.submissions}</p>
						</div>
						<div className="sm:col-span-3">
							<p className="text-muted-foreground text-xs">ISSUE</p>
							<p className="mt-1 font-medium">
								#{bounty.issueNumber} · {bounty.issueTitle || bounty.title}
							</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="border-b">
						<CardTitle className="text-base">Progress</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-5">
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
					<CardContent className="grid gap-5 text-sm sm:grid-cols-2">
						<div>
							<p className="text-muted-foreground text-xs">PULL REQUEST</p>
							<p className="mt-1 font-medium">
								{latestClaim
									? `PR #${latestClaim.githubPrNumber}`
									: "Waiting for merge"}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">MERGE COMMIT</p>
							<p className="mt-1 font-mono text-xs">
								{latestClaim?.mergeCommitSha
									? `${latestClaim.mergeCommitSha.slice(0, 10)}…`
									: "—"}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">REPOSITORY</p>
							<p className="mt-1 font-medium">{bounty.repository}</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">NETWORK</p>
							<p className="mt-1 font-medium">
								{chain?.name ?? chainConfig.name}
							</p>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="border-b">
						<CardTitle className="text-base">
							Submissions and participants
						</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{bounty.claims?.length ? (
							bounty.claims.map((item) => {
								const evidence = item.evidence as {
									prUrl?: string;
									authorLogin?: string;
								};
								return (
									<div
										className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0 last:pb-0"
										key={item.id}
									>
										<div>
											<p className="font-medium">
												PR #{item.githubPrNumber} ·{" "}
												{evidence.authorLogin ?? "Contributor"}
											</p>
											<p className="font-mono text-muted-foreground text-xs">
												{item.claimantWallet.slice(0, 10)}…
												{item.claimantWallet.slice(-8)}
											</p>
										</div>
										{evidence.prUrl && (
											<Button
												size="sm"
												variant="outline"
												render={
													<a
														href={evidence.prUrl}
														target="_blank"
														rel="noreferrer"
													/>
												}
											>
												View PR <ExternalLink data-icon="inline-end" />
											</Button>
										)}
									</div>
								);
							})
						) : (
							<p className="text-muted-foreground text-sm">
								No verified submissions yet. The first matching merged PR will
								appear here.
							</p>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="border-b">
						<CardTitle className="text-base">On-chain details</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-4 text-sm sm:grid-cols-2">
						<div>
							<p className="text-muted-foreground text-xs">BOUNTY ID</p>
							<p className="mt-1 font-mono">
								{bounty.onchainBountyId ?? "Pending"}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">TOKEN</p>
							<a
								className="mt-1 block font-mono text-xs underline"
								href={`${chain?.explorerUrl}/address/${chain?.tokenAddress}`}
								target="_blank"
								rel="noreferrer"
							>
								{chain?.tokenAddress}
							</a>
						</div>
						<div className="sm:col-span-2">
							<p className="text-muted-foreground text-xs">ESCROW CONTRACT</p>
							<a
								className="mt-1 block break-all font-mono text-xs underline"
								href={`${chain?.explorerUrl}/address/${chain?.escrowAddress}`}
								target="_blank"
								rel="noreferrer"
							>
								{chain?.escrowAddress}
							</a>
						</div>
						{bounty.settlement?.transactionHash && (
							<div className="sm:col-span-2">
								<p className="text-muted-foreground text-xs">
									SETTLEMENT TRANSACTION
								</p>
								<a
									className="mt-1 block break-all font-mono text-xs underline"
									href={`${chain?.explorerUrl}/tx/${bounty.settlement.transactionHash}`}
									target="_blank"
									rel="noreferrer"
								>
									{bounty.settlement.transactionHash}
								</a>
							</div>
						)}
					</CardContent>
				</Card>
			</div>
			<aside className="flex flex-col gap-5 lg:sticky lg:top-8 lg:h-fit">
				<Card>
					<CardHeader className="gap-4 border-b">
						<p className="text-muted-foreground text-xs">BOUNTY REWARD</p>
						<div className="font-semibold text-4xl tracking-tight">
							<UsdAmount amount={bounty.amount} />
						</div>
						<p className="text-muted-foreground text-sm">
							Deadline {new Date(bounty.deadline).toLocaleDateString()}
						</p>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						{(bounty.status === "Funded" || bounty.status === "ClaimPending") &&
							claim && (
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
					<CardContent className="flex flex-col gap-3 text-sm">
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
