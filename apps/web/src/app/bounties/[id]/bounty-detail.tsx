"use client";

import { escrowAbi } from "@pasinpay/chain";
import {
	Alert,
	AlertDescription,
	AlertTitle,
} from "@pasinpay/ui/components/alert";
import {
	Avatar,
	AvatarFallback,
	AvatarImage,
} from "@pasinpay/ui/components/avatar";
import { Badge } from "@pasinpay/ui/components/badge";
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
import { Spinner } from "@pasinpay/ui/components/spinner";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "@pasinpay/ui/components/tooltip";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowUpRight,
	Bot,
	Check,
	Clock3,
	Copy,
	ExternalLink,
	GitPullRequest,
	Info,
	Share2,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { Address } from "viem";
import {
	useAccount,
	usePublicClient,
	useReadContract,
	useSwitchChain,
	useWriteContract,
} from "wagmi";
import { CopyAddress } from "@/components/copy-address";
import { useAppNetwork } from "@/components/network-provider";
import { UsdAmount } from "@/components/usd-amount";
import {
	getBountyProgress,
	getCreatorActionAvailability,
	getPullRequestDescription,
	isClaimButtonVisible,
} from "@/lib/bounty-ui-state";
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

function statusVariant(
	status: string,
): "default" | "secondary" | "destructive" | "outline" {
	if (["Paid", "Verified"].includes(status)) return "default";
	if (["Funded", "Merged", "Superseded"].includes(status)) return "secondary";
	if (["Disputed", "Refunded", "Cancelled", "Closed"].includes(status)) {
		return "destructive";
	}
	return "outline";
}

const onchainStatusLabels = [
	"Open",
	"Funded",
	"ClaimPending",
	"Paid",
	"Disputed",
	"Refunded",
	"Cancelled",
] as const;

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

type BountyAction =
	| "submitClaim"
	| "approveClaim"
	| "finalizeClaim"
	| "disputeClaim"
	| "refundExpired"
	| "cancelBounty";

type TransactionState = {
	action: BountyAction;
	hash: `0x${string}`;
	phase: "confirming" | "confirmed" | "failed";
};

const actionStatus: Record<BountyAction, string> = {
	submitClaim: "ClaimPending",
	approveClaim: "ClaimPending",
	finalizeClaim: "Paid",
	disputeClaim: "Disputed",
	refundExpired: "Refunded",
	cancelBounty: "Cancelled",
};

function CreatorActionDialog({
	action,
	description,
	busy,
	details,
	label,
	onConfirm,
	summary,
	variant = "outline",
}: {
	action: string;
	description: string;
	busy: string | null;
	details: string;
	label: string;
	onConfirm: () => void;
	summary: string;
	variant?: "default" | "outline" | "destructive";
}) {
	const [open, setOpen] = useState(false);
	const pending = busy === action;
	return (
		<div className="flex items-start justify-between gap-3 rounded-md border p-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2">
					<p className="font-medium text-sm">{label}</p>
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									aria-label={`About ${label}`}
									size="icon"
									variant="ghost"
								/>
							}
						>
							<Info data-icon="inline-start" />
						</TooltipTrigger>
						<TooltipContent>{details}</TooltipContent>
					</Tooltip>
				</div>
				<p className="mt-1 text-muted-foreground text-xs leading-5">
					{summary}
				</p>
			</div>
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger
					render={
						<Button disabled={Boolean(busy)} size="sm" variant={variant} />
					}
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
		</div>
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
	const bountyEscrowAddress = (bounty?.chain.escrowAddress ??
		chainConfig.escrowAddress) as Address;
	const [busy, setBusy] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [optimisticStatus, setOptimisticStatus] = useState<string | null>(null);
	const [optimisticApproved, setOptimisticApproved] = useState<boolean | null>(
		null,
	);
	const [transaction, setTransaction] = useState<TransactionState | null>(null);
	const onchainBountyId = bounty?.onchainBountyId
		? BigInt(bounty.onchainBountyId)
		: undefined;
	const { data: onchainBounty, refetch: refetchOnchainBounty } =
		useReadContract({
			address: bountyEscrowAddress,
			abi: escrowAbi,
			functionName: "bounties",
			args: onchainBountyId === undefined ? undefined : [onchainBountyId],
			chainId: chainConfig.id,
			query: {
				enabled:
					onchainBountyId !== undefined && bountyEscrowAddress !== ZERO_ADDRESS,
				refetchInterval: 10_000,
			},
		});

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

	async function copyAgentPrompt(prompt: string) {
		try {
			await navigator.clipboard.writeText(prompt);
			toast.success("Agent prompt copied");
		} catch {
			toast.error("Could not copy the agent prompt");
		}
	}

	async function call(functionName: BountyAction) {
		if (!bounty?.onchainBountyId || !client || !address)
			return setError("Connect the wallet used for this bounty first.");
		const onchainBountyId = bounty.onchainBountyId;
		setBusy(functionName);
		setError(null);
		setTransaction(null);
		try {
			if (chainId !== chainConfig.id)
				await switchChainAsync({ chainId: chainConfig.id });
			if (bountyEscrowAddress === "0x0000000000000000000000000000000000000000")
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
				const rawCommitHash = (
					evidence.commitHash ?? claim.mergeCommitSha
				).replace(/^0x/i, "");
				if (!/^[a-f0-9]{40,64}$/i.test(rawCommitHash))
					throw new Error("The verified merge commit hash is invalid.");
				const commitHash =
					`0x${rawCommitHash.padStart(64, "0")}` as `0x${string}`;
				const expiresAt = BigInt(
					Math.floor(new Date(claim.attestationExpiresAt).getTime() / 1000),
				);
				const now = BigInt(Math.floor(Date.now() / 1000));
				const onchainBounty = await client.readContract({
					address: bountyEscrowAddress,
					abi: escrowAbi,
					functionName: "bounties",
					args: [BigInt(onchainBountyId)],
				});
				if (Number(onchainBounty[11]) !== 1)
					throw new Error(
						"This bounty is no longer funded and cannot accept a claim.",
					);
				if (onchainBounty[9] !== "0x0000000000000000000000000000000000000000")
					throw new Error("This bounty already has a claim in progress.");
				if (
					onchainBounty[10] !==
					"0x0000000000000000000000000000000000000000000000000000000000000000"
				)
					throw new Error("This bounty has already accepted a claim.");
				if (expiresAt <= now || expiresAt > onchainBounty[4])
					throw new Error(
						"The claim attestation is expired or outside the bounty deadline. Refresh the bounty and try again.",
					);
				const claimArgs = [
					BigInt(onchainBountyId),
					address,
					BigInt(evidence.prNumber ?? claim.githubPrNumber),
					commitHash,
					expiresAt,
					BigInt(claim.attestationNonce),
					claim.attestationSignature as `0x${string}`,
				] as const;
				await client.simulateContract({
					address: bountyEscrowAddress,
					abi: escrowAbi,
					functionName,
					account: address,
					args: claimArgs,
				});
				const hash = await writeWithFreshEip1559Fees(client, (fees) =>
					writeContractAsync({
						address: bountyEscrowAddress,
						abi: escrowAbi,
						functionName,
						args: claimArgs,
						...fees,
					}),
				);
				setTransaction({ action: functionName, hash, phase: "confirming" });
				const receipt = await client.waitForTransactionReceipt({ hash });
				if (receipt.status !== "success") {
					setTransaction({ action: functionName, hash, phase: "failed" });
					throw new Error(
						"The transaction was mined but reverted. No bounty state was changed.",
					);
				}
				setTransaction({ action: functionName, hash, phase: "confirmed" });
				setOptimisticStatus(actionStatus[functionName]);
			} else if (functionName === "refundExpired") {
				const hash = await writeWithFreshEip1559Fees(client, (fees) =>
					writeContractAsync({
						address: bountyEscrowAddress,
						abi: escrowAbi,
						functionName,
						args: [BigInt(onchainBountyId)],
						...fees,
					}),
				);
				setTransaction({ action: functionName, hash, phase: "confirming" });
				const receipt = await client.waitForTransactionReceipt({ hash });
				if (receipt.status !== "success") {
					setTransaction({ action: functionName, hash, phase: "failed" });
					throw new Error(
						"The transaction was mined but reverted. No bounty state was changed.",
					);
				}
				setTransaction({ action: functionName, hash, phase: "confirmed" });
				setOptimisticStatus(actionStatus[functionName]);
			} else {
				if (bounty.creatorWallet.toLowerCase() !== address.toLowerCase())
					throw new Error("Only the bounty creator can manage this bounty.");
				const hash = await writeWithFreshEip1559Fees(client, (fees) =>
					writeContractAsync({
						address: bountyEscrowAddress,
						abi: escrowAbi,
						functionName,
						args: [BigInt(onchainBountyId)],
						...fees,
					}),
				);
				setTransaction({ action: functionName, hash, phase: "confirming" });
				const receipt = await client.waitForTransactionReceipt({ hash });
				if (receipt.status !== "success") {
					setTransaction({ action: functionName, hash, phase: "failed" });
					throw new Error(
						"The transaction was mined but reverted. No bounty state was changed.",
					);
				}
				setTransaction({ action: functionName, hash, phase: "confirmed" });
				setOptimisticStatus(actionStatus[functionName]);
				if (functionName === "approveClaim") setOptimisticApproved(true);
			}
			await Promise.all([
				queryClient.refetchQueries({
					queryKey: trpc.bounties.getById.queryKey({ id }),
				}),
				queryClient.refetchQueries({
					queryKey: trpc.bounties.claim.queryKey({ bountyId: id }),
				}),
				refetchOnchainBounty(),
			]);
			toast.success(
				functionName === "submitClaim"
					? "Claim submitted. The bounty is now awaiting creator review."
					: `${functionName === "approveClaim" ? "Claim approved" : functionName === "finalizeClaim" ? "Reward released" : functionName === "disputeClaim" ? "Claim disputed" : functionName === "refundExpired" ? "Bounty refunded" : "Bounty cancelled"}. Transaction confirmed on-chain.`,
			);
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
	const onchainStatus = onchainBounty
		? (onchainStatusLabels[Number(onchainBounty[11])] ?? null)
		: null;
	const currentStatus = optimisticStatus ?? onchainStatus ?? bounty.status;
	const status = statusLabels[currentStatus] ?? currentStatus.toUpperCase();
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
	const progressComplete = getBountyProgress({
		currentStatus,
		hasClaim: Boolean(bounty.claims?.length),
		hasMergedPullRequest: Boolean(hasMergedPullRequest),
		hasOpenPullRequest: Boolean(hasOpenPullRequest),
	});
	const completed = progressComplete.filter(Boolean).length;
	const chain = bounty.chain;
	const issueUrl =
		bounty.issueUrl ||
		`https://github.com/${bounty.repository}/issues/${bounty.issueNumber}`;
	const latestClaim = bounty.claims?.[0] ?? claim;
	const latestEvidence = latestClaim?.evidence as
		| {
				commitHash?: string;
				prUrl?: string;
		  }
		| undefined;
	const latestCommitHash =
		latestEvidence?.commitHash ?? latestClaim?.mergeCommitSha;
	const latestPullRequestUrl =
		latestEvidence?.prUrl ??
		(latestClaim
			? `https://github.com/${bounty.repository}/pull/${latestClaim.githubPrNumber}`
			: null);
	const latestCommitUrl = latestCommitHash
		? `https://github.com/${bounty.repository}/commit/${latestCommitHash}`
		: null;
	const isCreator =
		Boolean(address) &&
		address?.toLowerCase() === bounty.creatorWallet.toLowerCase();
	const isExpired = new Date(bounty.deadline).getTime() <= Date.now();
	const reviewEndsAt = onchainBounty?.[6]
		? Number(onchainBounty[6]) * 1000
		: bounty.reviewEnds
			? new Date(bounty.reviewEnds).getTime()
			: null;
	const reviewClosed = reviewEndsAt !== null && reviewEndsAt <= Date.now();
	const approved = optimisticApproved ?? Boolean(onchainBounty?.[12]);
	const isOnchainClaimantSet =
		Boolean(onchainBounty?.[9]) && onchainBounty?.[9] !== ZERO_ADDRESS;
	const {
		canCancel,
		canRefund,
		canDispute,
		canApprove,
		canFinalize,
		hasCreatorAction,
	} = getCreatorActionAvailability({
		currentStatus,
		isCreator,
		isExpired,
		reviewClosed,
		approved,
	});
	const reviewEndsLabel = reviewEndsAt
		? new Date(reviewEndsAt).toLocaleString()
		: "the review window ends";
	const claimButtonVisible = isClaimButtonVisible({
		currentStatus,
		hasOnchainClaimant: isOnchainClaimantSet,
		hasClaimAttestation: Boolean(claim),
	});
	const transactionLabel = transaction
		? transaction.phase === "confirming"
			? "Waiting for on-chain confirmation…"
			: transaction.phase === "confirmed"
				? "Transaction confirmed on-chain"
				: "Transaction reverted on-chain"
		: null;
	const transactionExplorerUrl = transaction?.hash
		? `${chainConfig.explorerUrl}/tx/${transaction.hash}`
		: null;
	/*
	 * The server's indexed status may lag the receipt by a few seconds. The
	 * contract read and the optimistic post-receipt status keep the action bar
	 * truthful during that short indexing window.
	 */
	const pullRequestUrl =
		"https://github.com/" +
		bounty.repository +
		"/compare?expand=1&title=" +
		encodeURIComponent(`[PasinPay #${bounty.issueNumber}] `) +
		"&body=" +
		encodeURIComponent(
			"Closes #" +
				bounty.issueNumber +
				"\n\nPasinPay bounty: " +
				(typeof window === "undefined" ? "" : window.location.href),
		);
	const agentPrompt = [
		`Work on the PasinPay bounty: ${bounty.title}`,
		`Repository: https://github.com/${bounty.repository}`,
		`Issue: ${issueUrl}`,
		`Bounty status: ${currentStatus}`,
		`Reward: ${bounty.amount} USDG before any applicable platform fee`,
		"",
		`Read the issue carefully, implement the smallest production-quality change, add or update tests, and run the repository's checks before opening a pull request.`,
		`Open the pull request with a title beginning exactly with [PasinPay #${bounty.issueNumber}]. Link the issue and describe the validation performed. Do not include secrets, private keys, or wallet credentials in the repository.`,
		"PasinPay verifies the merged commit and the linked contributor wallet before any creator approval or payout. Creating this PR does not guarantee payment.",
	].join("\n");
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
					<div className="mt-5">
						<h1 className="font-semibold text-4xl tracking-tight">
							{bounty.title}
						</h1>
						<div className="mt-2 flex flex-wrap items-center gap-2">
							<p className="text-muted-foreground">
								Issue #{bounty.issueNumber} · {bounty.repository}
							</p>
							<Badge variant={statusVariant(currentStatus)}>{status}</Badge>
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
								href={`${chain?.explorerUrl}/address/${bounty.creator.wallet}`}
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
							{latestPullRequestUrl && latestClaim ? (
								<a
									className="mt-1 inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-foreground"
									href={latestPullRequestUrl}
									target="_blank"
									rel="noreferrer"
								>
									PR #{latestClaim.githubPrNumber}{" "}
									<ExternalLink className="size-3" />
								</a>
							) : (
								<p className="mt-1 font-medium">Waiting for merge</p>
							)}
						</div>
						<div>
							<p className="text-muted-foreground text-xs">MERGE COMMIT</p>
							{latestCommitUrl ? (
								<a
									className="mt-1 inline-flex items-center gap-1 font-mono text-xs underline underline-offset-2 hover:text-foreground"
									href={latestCommitUrl}
									target="_blank"
									rel="noreferrer"
								>
									{latestCommitHash?.slice(0, 10)}…{" "}
									<ExternalLink className="size-3" />
								</a>
							) : (
								<p className="mt-1 font-mono text-xs">—</p>
							)}
						</div>
						<div>
							<p className="text-muted-foreground text-xs">REPOSITORY</p>
							<a
								className="mt-1 inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:text-foreground"
								href={`https://github.com/${bounty.repository}`}
								target="_blank"
								rel="noreferrer"
							>
								{bounty.repository} <ExternalLink className="size-3" />
							</a>
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
												<Badge variant={statusVariant(pullRequest.status)}>
													{pullRequest.status.toUpperCase()}
												</Badge>
											</div>
											<p className="mt-1 text-muted-foreground text-xs">
												{pullRequest.authorLogin
													? `@${pullRequest.authorLogin}`
													: "Unknown contributor"}
												{" · "}
												{getPullRequestDescription(pullRequest.status)}
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
						{claimButtonVisible && (
							<Button
								disabled={Boolean(busy)}
								onClick={() => call("submitClaim")}
							>
								{busy === "submitClaim" ? "Submitting…" : "Claim USDG"}
								<ArrowUpRight data-icon="inline-end" />
							</Button>
						)}
						{currentStatus === "ClaimPending" && !transaction && (
							<Alert>
								<AlertTitle>Claim submitted</AlertTitle>
								<AlertDescription>
									The claim is recorded on-chain and is waiting for creator
									review. The reward is not released until the claim is approved
									and the review window has ended.
								</AlertDescription>
							</Alert>
						)}
						{currentStatus === "Paid" && (
							<Button render={<Link href={`/receipts/${bounty.id}`} />}>
								View settlement <ExternalLink data-icon="inline-end" />
							</Button>
						)}
						{transaction && transactionLabel && (
							<Alert
								variant={
									transaction.phase === "failed" ? "destructive" : "default"
								}
							>
								{transaction.phase === "confirming" && <Spinner />}
								<AlertTitle>{transactionLabel}</AlertTitle>
								<AlertDescription>
									{transaction.phase === "confirming"
										? "Keep this page open while the network confirms the transaction. The action will not be treated as complete until a successful receipt is returned."
										: transaction.phase === "confirmed"
											? "The frontend has verified a successful receipt and refreshed the on-chain and server-backed state."
											: "The network rejected this transaction. No state transition was applied; you can review the error and try again."}
									{transactionExplorerUrl && (
										<a
											className="mt-1 block underline underline-offset-2"
											href={transactionExplorerUrl}
											target="_blank"
											rel="noreferrer"
										>
											View transaction on the block explorer
										</a>
									)}
								</AlertDescription>
							</Alert>
						)}
						{error && <p className="text-destructive text-sm">{error}</p>}
						{currentStatus === "ClaimPending" && (
							<p className="flex items-center gap-2 text-muted-foreground text-xs">
								<Clock3 data-icon="inline-start" /> Creator approval and review
								required
							</p>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader className="gap-2 border-b">
						<CardTitle className="flex items-center gap-2 text-base">
							<Bot className="size-4" /> Agent brief
						</CardTitle>
						<p className="text-muted-foreground text-xs leading-5">
							Copy this context into Codex, Claude, Gemini, or another coding
							agent. The agent works in your repository; PasinPay never receives
							its credentials.
						</p>
					</CardHeader>
					<CardContent className="flex flex-col gap-3">
						<pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-muted-foreground text-xs leading-5">
							{agentPrompt}
						</pre>
						<Button
							onClick={() => void copyAgentPrompt(agentPrompt)}
							size="sm"
							variant="outline"
						>
							<Copy data-icon="inline-start" /> Copy agent prompt
						</Button>
					</CardContent>
				</Card>
				{isCreator && (
					<TooltipProvider delay={200}>
						<Card>
							<CardHeader className="gap-2 border-b">
								<CardTitle className="text-base">Creator controls</CardTitle>
								<p className="text-muted-foreground text-xs leading-5">
									Manage this escrow based on the verified on-chain state. Each
									action opens your wallet for approval and only changes the
									bounty after a successful receipt.
								</p>
							</CardHeader>
							<CardContent className="flex flex-col gap-3">
								{canCancel && (
									<CreatorActionDialog
										action="cancelBounty"
										details="Cancels an open bounty before it is funded. Because no funds are held in escrow yet, there is no contributor payout or refund transaction."
										summary="Close this bounty before funding. This cannot be undone."
										description="This permanently cancels the open bounty. No escrowed funds will be paid out, and contributors will no longer be able to use this bounty."
										busy={busy}
										label="Cancel bounty"
										onConfirm={() => void call("cancelBounty")}
										variant="destructive"
									/>
								)}
								{canRefund && (
									<CreatorActionDialog
										action="refundExpired"
										details="Returns the full funded amount, including the platform fee, to the creator after the deadline when no approved claim can be finalized."
										summary="Recover the escrow after the bounty deadline has passed."
										description="The deadline has passed. This refunds the total escrowed amount to the creator. It is unavailable once a claim has been approved."
										busy={busy}
										label="Refund expired bounty"
										onConfirm={() => void call("refundExpired")}
										variant="destructive"
									/>
								)}
								{canDispute && (
									<CreatorActionDialog
										action="disputeClaim"
										details="Moves the claim into dispute and prevents the normal approval/finalization path. Resolution is an owner-only escrow operation."
										summary="Pause settlement if the submitted work needs an owner dispute."
										description="This opens a dispute for the pending claim before the review window closes. The normal reward release path pauses until the escrow owner resolves the dispute."
										busy={busy}
										label="Dispute claim"
										onConfirm={() => void call("disputeClaim")}
										variant="destructive"
									/>
								)}
								{canApprove && (
									<CreatorActionDialog
										action="approveClaim"
										details="Records your approval on-chain. It does not pay the contributor immediately; finalization remains blocked until the review window has ended."
										summary={`Confirm the verified work. The review window ends ${reviewEndsLabel}.`}
										description={`Approve the verified claim for this bounty. This records creator approval on-chain, but the reward remains in escrow until the review window ends at ${reviewEndsLabel}.`}
										busy={busy}
										label="Approve claim"
										onConfirm={() => void call("approveClaim")}
									/>
								)}
								{canFinalize && (
									<CreatorActionDialog
										action="finalizeClaim"
										details="Releases the advertised reward to the attested claimant wallet and sends the platform fee to the configured treasury. This is irreversible."
										summary="Release the reward after approval and the review window."
										description="Finalize the approved claim after the review window has ended. The escrow transfers the advertised reward to the attested contributor and routes the platform fee to the treasury. This cannot be reversed."
										busy={busy}
										label="Finalize after review"
										onConfirm={() => void call("finalizeClaim")}
									/>
								)}
								{!hasCreatorAction && (
									<Alert>
										<Info />
										<AlertTitle>
											{["Paid", "Refunded", "Cancelled"].includes(currentStatus)
												? "Escrow concluded"
												: "No creator action available"}
										</AlertTitle>
										<AlertDescription>
											{currentStatus === "Paid"
												? "The approved claim has been finalized and the reward has been released. No further creator action is possible."
												: currentStatus === "Refunded"
													? "The escrow has been refunded after expiry. No further creator action is possible."
													: currentStatus === "Cancelled"
														? "This bounty was cancelled before settlement. No further creator action is possible."
														: currentStatus === "Funded"
															? "The bounty is funded and within its deadline. Creator actions become available after a claim, or after expiry when an eligible refund can be made."
															: currentStatus === "ClaimPending" && !approved
																? "A verified claim is waiting for your approval. Review the linked GitHub evidence before approving it on-chain."
																: currentStatus === "ClaimPending"
																	? "The claim is approved and the review window is still open. Finalization becomes available when the window ends."
																	: "The verified on-chain state does not currently expose an eligible creator action."}
										</AlertDescription>
									</Alert>
								)}
							</CardContent>
						</Card>
					</TooltipProvider>
				)}
				{!["Paid", "Refunded", "Cancelled"].includes(currentStatus) && (
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
				)}
			</aside>
		</main>
	);
}
