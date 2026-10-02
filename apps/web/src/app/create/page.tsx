"use client";

import { erc20MetadataAbi, escrowAbi } from "@pasinpay/chain";
import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { Input } from "@pasinpay/ui/components/input";
import { Label } from "@pasinpay/ui/components/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@pasinpay/ui/components/select";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, GitBranch, LockKeyhole, WalletCards } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { parseEventLogs, parseUnits } from "viem";
import {
	useAccount,
	usePublicClient,
	useReadContract,
	useSwitchChain,
	useWriteContract,
} from "wagmi";
import { AuthGuard } from "@/components/auth-guard";
import { activeChain, webChainConfig } from "@/lib/wallet";
import { trpc } from "@/utils/trpc";

const erc20ApproveAbi = [
	{
		type: "function",
		name: "approve",
		stateMutability: "nonpayable",
		inputs: [
			{ name: "spender", type: "address" },
			{ name: "amount", type: "uint256" },
		],
		outputs: [{ type: "bool" }],
	},
] as const;

export default function CreateBountyPage() {
	const [title, setTitle] = useState("Fix checkout timeout");
	const [repository, setRepository] = useState("");
	const [issueNumber, setIssueNumber] = useState("17");
	const [amount, setAmount] = useState("500");
	const [deadline, setDeadline] = useState(() =>
		new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
	);
	const [error, setError] = useState<string | null>(null);
	const [step, setStep] = useState<
		"idle" | "creating" | "approving" | "funding"
	>("idle");
	const { address, chainId } = useAccount();
	const { switchChainAsync } = useSwitchChain();
	const client = usePublicClient();
	const { writeContractAsync } = useWriteContract();
	const { data: decimals } = useReadContract({
		address: webChainConfig.usdgAddress,
		abi: erc20MetadataAbi,
		functionName: "decimals",
		chainId: activeChain.id,
	});
	const register = useMutation(trpc.bounties.register.mutationOptions());
	const syncStatus = useMutation(trpc.bounties.syncStatus.mutationOptions());
	const repositories = useQuery(trpc.bounties.repositories.queryOptions());

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		if (!address)
			return setError("Connect your wallet before funding a bounty.");
		const selectedRepository = repositories.data?.find(
			(item) => item.fullName === repository,
		);
		if (!selectedRepository)
			return setError(
				"Select a repository installed through the GitHub App before funding.",
			);
		if (chainId !== activeChain.id) {
			await switchChainAsync({ chainId: activeChain.id });
		}
		if (!client || !decimals)
			return setError("USDG metadata is not available yet. Try again shortly.");
		try {
			const rawAmount = parseUnits(amount, decimals);
			const repositoryHash = selectedRepository.repositoryHash as `0x${string}`;
			const deadlineSeconds = BigInt(
				Math.floor(new Date(deadline).getTime() / 1000),
			);
			setStep("creating");
			const creationHash = await writeContractAsync({
				address: webChainConfig.escrowAddress,
				abi: escrowAbi,
				functionName: "createBounty",
				args: [
					repositoryHash,
					Number(issueNumber),
					deadlineSeconds,
					BigInt(60),
				],
			});
			const creationReceipt = await client.waitForTransactionReceipt({
				hash: creationHash,
			});
			const [created] = parseEventLogs({
				abi: escrowAbi,
				eventName: "BountyCreated",
				logs: creationReceipt.logs,
			});
			if (!created?.args.bountyId)
				throw new Error("Could not read the created bounty ID");
			const registered = await register.mutateAsync({
				onchainBountyId: created.args.bountyId.toString(),
				creatorWallet: address,
				repository,
				repositoryHash,
				issueNumber: Number(issueNumber),
				title: `[PasinPay #${Number(issueNumber)}] ${title.trim()}`,
				amount: rawAmount.toString(),
				deadline: new Date(Number(deadlineSeconds) * 1000),
				reviewWindowSeconds: 60,
			});
			setStep("approving");
			const approvalHash = await writeContractAsync({
				address: webChainConfig.usdgAddress,
				abi: erc20ApproveAbi,
				functionName: "approve",
				args: [webChainConfig.escrowAddress, rawAmount],
			});
			await client.waitForTransactionReceipt({ hash: approvalHash });
			setStep("funding");
			const fundingHash = await writeContractAsync({
				address: webChainConfig.escrowAddress,
				abi: escrowAbi,
				functionName: "fundBounty",
				args: [created.args.bountyId, rawAmount],
			});
			await client.waitForTransactionReceipt({ hash: fundingHash });
			await syncStatus.mutateAsync({
				onchainBountyId: created.args.bountyId.toString(),
				status: "Funded",
			});
			window.location.href = `/bounties/${registered.id}`;
		} catch (cause) {
			setStep("idle");
			setError(
				cause instanceof Error
					? cause.message
					: "The transaction could not be completed.",
			);
		}
	}

	return (
		<AuthGuard>
			<main className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[1fr_360px]">
				<div>
					<p className="text-muted-foreground text-sm">NEW BOUNTY</p>
					<h1 className="mt-2 font-semibold text-4xl tracking-tight">
						Fund GitHub work
					</h1>
					<p className="mt-3 max-w-xl text-muted-foreground">
						Lock USDG against a specific issue. The payment condition is a
						merged pull request.
					</p>
					<form className="mt-8 flex flex-col gap-6" onSubmit={submit}>
						<Card>
							<CardHeader>
								<CardTitle>Task details</CardTitle>
								<CardDescription>
									Keep the task reference deterministic so evidence can be
									verified.
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-5 sm:grid-cols-2">
								<div className="flex flex-col gap-2 sm:col-span-2">
									<Label htmlFor="title">Task title</Label>
									<p className="text-muted-foreground text-sm">
										The GitHub PR title must start with [PasinPay #
										{issueNumber || "issue"}].
									</p>
									<Input
										id="title"
										value={title}
										onChange={(event) => setTitle(event.target.value)}
										required
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="repository">Repository</Label>
									<Select
										value={repository}
										onValueChange={(value) => setRepository(value ?? "")}
									>
										<SelectTrigger id="repository" className="w-full">
											<SelectValue placeholder="Select an installed repository" />
										</SelectTrigger>
										<SelectContent>
											{repositories.data?.map((item) => (
												<SelectItem key={item.id} value={item.fullName}>
													{item.fullName}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									{!repositories.isLoading && !repositories.data?.length && (
										<p className="text-muted-foreground text-sm">
											No installed repositories yet. Sync them from{" "}
											<Link
												className="underline underline-offset-4"
												href="/settings"
											>
												Settings
											</Link>
											.
										</p>
									)}
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="issue">Issue number</Label>
									<Input
										id="issue"
										inputMode="numeric"
										value={issueNumber}
										onChange={(event) => setIssueNumber(event.target.value)}
										required
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="amount">Reward in USDG</Label>
									<Input
										id="amount"
										inputMode="decimal"
										value={amount}
										onChange={(event) => setAmount(event.target.value)}
										required
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="deadline">Deadline</Label>
									<Input
										id="deadline"
										type="datetime-local"
										value={deadline}
										onChange={(event) => setDeadline(event.target.value)}
										required
									/>
								</div>
							</CardContent>
						</Card>
						<div className="flex flex-wrap items-center gap-3">
							<Button type="submit" size="lg" disabled={step !== "idle"}>
								{step === "creating" ? (
									"Creating bounty…"
								) : step === "approving" ? (
									"Approve USDG…"
								) : step === "funding" ? (
									"Funding bounty…"
								) : (
									<>
										Fund ${amount} USDG <ArrowRight data-icon="inline-end" />
									</>
								)}
							</Button>
							{error && <p className="text-destructive text-sm">{error}</p>}
						</div>
					</form>
				</div>
				<Card className="h-fit lg:sticky lg:top-8">
					<CardHeader>
						<CardTitle className="text-base">Payment preview</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-col gap-5">
						<div>
							<p className="font-semibold text-xl">
								{title || "Untitled task"}
							</p>
							<p className="mt-1 text-muted-foreground text-sm">
								{repository || "owner/repository"} · Issue #{issueNumber || "—"}
							</p>
						</div>
						<div className="font-semibold text-3xl">
							${amount || "0"}
							<span className="ml-2 font-medium text-muted-foreground text-sm">
								USDG
							</span>
						</div>
						<div className="flex flex-col gap-3 border-t pt-5 text-muted-foreground text-sm">
							<span className="flex items-center gap-2">
								<GitBranch className="size-4" /> Merged pull request
							</span>
							<span className="flex items-center gap-2">
								<LockKeyhole className="size-4" /> Non-custodial escrow
							</span>
							<span className="flex items-center gap-2">
								<WalletCards className="size-4" /> {activeChain.name}
							</span>
						</div>
						<Link
							className="text-sm underline underline-offset-4"
							href="/settings"
						>
							Connect GitHub and wallet first
						</Link>
					</CardContent>
				</Card>
			</main>
		</AuthGuard>
	);
}
