"use client";

import { escrowAbi } from "@pasinpay/chain";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@pasinpay/ui/components/avatar";
import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
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
	DialogTrigger,
} from "@pasinpay/ui/components/dialog";
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
	Copy,
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
import { CopyAddress } from "@/components/copy-address";
import { useAppNetwork } from "@/components/network-provider";
import { UsdAmount } from "@/components/usd-amount";
import { getReadableError } from "@/lib/errors";
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

function CreatorActionDialog({
	action,
	description,
	busy,
	label,
	onConfirm,
	variant = "outline",
}: {
	action: string;
	description: string;
	busy: string | null;
	label: string;
	onConfirm: () => void;
	variant?: "default" | "outline" | "destructive";
}) {
	const [open, setOpen] = useState(false);
	const pending = busy === action;
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger
				render={<Button disabled={Boolean(busy)} size="sm" variant={variant} />}
			>
				{pending ? `${label}…` : label}
			</DialogTrigger>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{label}?</DialogTitle>
					<DialogDescription>{description}</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<DialogClose render={<Button variant="outline" />}>
						Keep open
					</DialogClose>
					<Button
						disabled={pending}
						onClick={() => {
							onConfirm();
							setOpen(false);
						}}
						variant={variant === "outline" ? "default" : variant}
					>
						Confirm
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

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

	async function copyClaimTitle() {
		try {
			await navigator.clipboard.writeText(
				`[PasinPay #${bounty?.issueNumber ?? ""}]`,
			);
			toast.success("PR title marker copied");
		} catch {
			toast.error("Could not copy the PR title marker");
		}
	}

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
		functionName:
			| "submitClaim"
			| "approveClaim"
			| "finalizeClaim"
			| "disputeClaim"
			| "refundExpired"
			| "cancelBounty",
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
			} else if (functionName === "refundExpired") {
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
			} else {
				if (bounty.creatorWallet.toLowerCase() !== address.toLowerCase())
					throw new Error("Only the bounty creator can manage this bounty.");
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
			const message = getReadableError(
				cause,
				"Transaction failed. Please try again.",
			);
			setError(message);
			toast.error(message);
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
	const hasOpenPullRequest = bounty.pullRequests?.some(
		(item) => item.status === "Open",
	);
	const hasMergedPullRequest = bounty.pullRequests?.some((item) =>
		Boolean(item.mergedAt),
	);
	const progressComplete = [
		true,
		bounty.status !== "Open",
		Boolean(hasOpenPullRequest || hasMergedPullRequest),
		Boolean(hasMergedPullRequest || bounty.claims?.length),
		Boolean(bounty.claims?.length),
	];
	const completed = progressComplete.filter(Boolean).length;
	const chain = bounty.chain;
	const issueUrl =
		bounty.issueUrl ||
		`https://github.com/${bounty.repository}/issues/${bounty.issueNumber}`;
	const latestClaim = bounty.claims?.[0] ?? claim;
	const isCreator =
		Boolean(address) &&
		address?.toLowerCase() === bounty.creatorWallet.toLowerCase();
	const isExpired = new Date(bounty.deadline).getTime() <= Date.now();
	const reviewClosed =
		Boolean(bounty.reviewEnds) &&
		new Date(bounty.reviewEnds ?? 0).getTime() <= Date.now();
	const hasCreatorAction =
		bounty.status === "Open" ||
		bounty.status === "ClaimPending" ||
		((bounty.status === "Funded" || bounty.status === "ClaimPending") &&
			isExpired);
	const pullRequestUrl =
		"https://github.com/" +
		bounty.repository +
		"/compare?expand=1&title=" +
		encodeURIComponent("[PasinPay #" + bounty.issueNumber + "] ") +
		"&body=" +
		encodeURIComponent(
			"Closes #" +
				bounty.issueNumber +
				"\n\nPasinPay bounty: " +
				(typeof window === "undefined" ? "" : window.location.href),
		);
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
					<div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
						<div>
							<h1 className="font-semibold text-4xl tracking-tight">
								{bounty.title}
							</h1>
							<p className="mt-2 text-muted-foreground">
								Issue #{bounty.issueNumber} · {bounty.repository}
							</p>
						</div>
						<div className="w-fit shrink-0 rounded-full border bg-muted/40 px-3 py-1.5 font-medium text-xs sm:mt-1">
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
					<CardContent className="flex flex-wrap items-center gap-4">
						<Avatar size="lg">
							{bounty.creator.image && (
								<AvatarImage
									alt={bounty.creator.name}
									src={bounty.creator.image}
								/>
							)}
							<AvatarFallback>
								{bounty.creator.name.slice(0, 2).toUpperCase()}
							</AvatarFallback>
						</Avatar>
						<div className="min-w-0">
							<p className="text-muted-foreground text-xs uppercase tracking-wide">
								Created by
							</p>
							<p className="font-medium">{bounty.creator.name}</p>
							{bounty.creator.githubUrl && bounty.creator.githubLogin && (
								<a
									className="text-muted-foreground text-sm hover:underline"
									href={bounty.creator.githubUrl}
									target="_blank"
									rel="noreferrer"
								>
									@{bounty.creator.githubLogin}
								</a>
							)}
						</div>
						<div className="ml-auto min-w-56 text-left sm:text-right">
							<p className="text-muted-foreground text-xs uppercase tracking-wide">
								Creator wallet
							</p>
							<CopyAddress
								address={bounty.creator.wallet}
								href={chain?.explorerUrl + "/address/" + bounty.creator.wallet}
								label="Creator wallet"
							/>
						</div>
					</CardContent>
				</Card>
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
									{progressComplete[index] ? (
										<Check className="size-3.5" />
									) : (
										index + 1
									)}
								</span>
								<span
									className={
										progressComplete[index]
											? "font-medium"
											: "text-muted-foreground"
									}
								>
									{step}
								</span>
								{index === completed && completed < steps.length && (
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
						{bounty.pullRequests?.length ? (
							bounty.pullRequests.map((pullRequest) => {
								const verifiedClaim = bounty.claims?.find(
									(item) => item.githubPrNumber === pullRequest.number,
								);
								return (
									<div
										className="flex flex-wrap items-start justify-between gap-4 border-b pb-4 last:border-0 last:pb-0"
										key={pullRequest.number}
									>
										<div className="min-w-0">
											<div className="flex flex-wrap items-center gap-2">
												<a
													className="truncate font-medium hover:underline"
													href={pullRequest.htmlUrl}
													target="_blank"
													rel="noreferrer"
												>
													PR #{pullRequest.number} · {pullRequest.title}
												</a>
												<span className="rounded-full border px-2 py-0.5 font-medium text-[11px]">
													{pullRequest.status.toUpperCase()}
												</span>
											</div>
											<p className="mt-1 text-muted-foreground text-xs">
												{pullRequest.authorLogin
													? "@" + pullRequest.authorLogin
													: "Unknown contributor"}
												{" · "}
												{pullRequest.status === "Open"
													? "Awaiting merge"
													: pullRequest.status === "Merged"
														? "Merged · verification pending"
														: pullRequest.status === "Verified"
															? "Verified evidence"
															: "Closed"}
											</p>
											{verifiedClaim && (
												<div className="mt-1 flex items-center gap-1 text-muted-foreground text-xs">
													<span>Payout wallet</span>
													<CopyAddress
														address={verifiedClaim.claimantWallet}
														href={`${chain?.explorerUrl}/address/${verifiedClaim.claimantWallet}`}
														label="Payout wallet"
													/>
												</div>
											)}
										</div>
										<Button
											size="sm"
											variant="outline"
											render={
												<a
													href={pullRequest.htmlUrl}
													target="_blank"
													rel="noreferrer"
												/>
											}
										>
											View PR <ExternalLink data-icon="inline-end" />
										</Button>
									</div>
								);
							})
						) : (
							<p className="text-muted-foreground text-sm">
								No matching pull requests yet. Open a PR that references this
								issue and uses the [PasinPay #{bounty.issueNumber}] title
								marker.
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
							<div className="mt-1">
								{chain?.tokenAddress && (
									<CopyAddress
										address={chain.tokenAddress}
										href={`${chain.explorerUrl}/address/${chain.tokenAddress}`}
										label="Token address"
									/>
								)}
							</div>
						</div>
						<div className="sm:col-span-2">
							<p className="text-muted-foreground text-xs">ESCROW CONTRACT</p>
							<div className="mt-1">
								{chain?.escrowAddress && (
									<CopyAddress
										address={chain.escrowAddress}
										href={`${chain.explorerUrl}/address/${chain.escrowAddress}`}
										label="Escrow contract"
									/>
								)}
							</div>
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
						{bounty.status === "Paid" && (
							<Button render={<Link href={`/receipts/${bounty.id}`} />}>
								View settlement <ExternalLink data-icon="inline-end" />
							</Button>
						)}
						{error && <p className="text-destructive text-sm">{error}</p>}
						<p className="flex items-center gap-2 text-muted-foreground text-xs">
							<Clock3 className="size-3.5" /> Creator approval and review
							required
						</p>
					</CardContent>
				</Card>
				{isCreator && (
					<Card>
						<CardHeader className="gap-2 border-b">
							<CardTitle className="text-base">Creator controls</CardTitle>
							<p className="text-muted-foreground text-xs leading-5">
								Manage this escrow based on its current on-chain state. Every
								action requires wallet approval.
							</p>
						</CardHeader>
						<CardContent className="flex flex-col gap-2">
							{bounty.status === "Open" && (
								<CreatorActionDialog
									action="cancelBounty"
									description="This cancels the open bounty. No escrowed funds will be paid out."
									busy={busy}
									label="Cancel bounty"
									onConfirm={() => void call("cancelBounty")}
									variant="destructive"
								/>
							)}
							{(bounty.status === "Funded" ||
								bounty.status === "ClaimPending") &&
								isExpired && (
									<CreatorActionDialog
										action="refundExpired"
										description="The deadline has passed. This refunds the escrow according to the contract rules."
										busy={busy}
										label="Refund expired bounty"
										onConfirm={() => void call("refundExpired")}
										variant="destructive"
									/>
								)}
							{bounty.status === "ClaimPending" && !reviewClosed && (
								<CreatorActionDialog
									action="disputeClaim"
									description="This opens a dispute and pauses automatic settlement for owner resolution."
									busy={busy}
									label="Dispute claim"
									onConfirm={() => void call("disputeClaim")}
									variant="destructive"
								/>
							)}
							{bounty.status === "ClaimPending" && reviewClosed && (
								<CreatorActionDialog
									action="approveClaim"
									description="Approve the verified work so it can be finalized after the review window."
									busy={busy}
									label="Approve claim"
									onConfirm={() => void call("approveClaim")}
								/>
							)}
							{bounty.status === "ClaimPending" && reviewClosed && (
								<CreatorActionDialog
									action="finalizeClaim"
									description="Finalize the approved claim and release the reward to the attested wallet."
									busy={busy}
									label="Finalize after review"
									onConfirm={() => void call("finalizeClaim")}
								/>
							)}
							{!hasCreatorAction &&
								bounty.status !== "Paid" &&
								bounty.status !== "Refunded" &&
								bounty.status !== "Cancelled" && (
									<p className="text-muted-foreground text-xs">
										No creator action is available while this bounty is funded
										and within its deadline. Review actions appear after a
										verified claim; refund becomes available after the deadline.
									</p>
								)}
						</CardContent>
					</Card>
				)}
				<Card>
					<CardContent className="flex flex-col gap-3 text-sm">
						<p className="flex items-center gap-2 font-medium">
							<GitPullRequest className="size-4" /> How to claim
						</p>
						<p className="rounded-md text-muted-foreground leading-6 transition-colors hover:bg-muted/60">
							Open a PR with{" "}
							<button
								className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 font-mono text-xs underline-offset-2 transition-colors hover:bg-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								onClick={() => void copyClaimTitle()}
								type="button"
								title="Copy PR title marker"
							>
								[PasinPay #{bounty.issueNumber}]
								<Copy aria-hidden="true" className="size-3" />
							</button>{" "}
							in the title. Once merged, PasinPay verifies the evidence.
						</p>
						<Button
							size="sm"
							render={
								<a href={pullRequestUrl} target="_blank" rel="noreferrer" />
							}
						>
							Start a pull request <ArrowUpRight data-icon="inline-end" />
						</Button>
					</CardContent>
				</Card>
			</aside>
		</main>
	);
}
