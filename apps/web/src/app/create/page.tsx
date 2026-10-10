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
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@pasinpay/ui/components/popover";
import { ScrollArea } from "@pasinpay/ui/components/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@pasinpay/ui/components/select";
import { Textarea } from "@pasinpay/ui/components/textarea";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	ChevronDown,
	ExternalLink,
	GitBranch,
	LockKeyhole,
	Plus,
	Search,
	WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useDeferredValue, useEffect, useState } from "react";
import {
	encodeAbiParameters,
	formatUnits,
	keccak256,
	parseEventLogs,
	parseUnits,
	stringToHex,
} from "viem";
import {
	useAccount,
	usePublicClient,
	useReadContract,
	useSignTypedData,
	useSwitchChain,
	useWriteContract,
} from "wagmi";
import { AuthGuard } from "@/components/auth-guard";
import { useAppNetwork } from "@/components/network-provider";
import { authClient } from "@/lib/auth-client";
import { getReadableError } from "@/lib/errors";
import { writeWithFreshEip1559Fees } from "@/lib/transaction-fees";
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

type CreationMode = "existing" | "new";

export default function CreateBountyPage() {
	const [creationMode, setCreationMode] = useState<CreationMode>("existing");
	const [title, setTitle] = useState("");
	const [issueBody, setIssueBody] = useState("");
	const [repository, setRepository] = useState("");
	const [issueNumber, setIssueNumber] = useState("");
	const [issueTitle, setIssueTitle] = useState("");
	const [issueUrl, setIssueUrl] = useState("");
	const [issueSearch, setIssueSearch] = useState("");
	const [issuePickerOpen, setIssuePickerOpen] = useState(false);
	const [amount, setAmount] = useState("");
	const [deadline, setDeadline] = useState(() =>
		new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 16),
	);
	const [error, setError] = useState<string | null>(null);
	const [step, setStep] = useState<
		"idle" | "creating" | "approving" | "funding"
	>("idle");
	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		if (params.get("mcp") !== "1") return;
		setRepository(params.get("repository") ?? "");
		setIssueNumber(params.get("issueNumber") ?? "");
		setTitle(params.get("title") ?? "");
		setAmount(params.get("rewardUsd") ?? "");
		const requestedDeadline = params.get("deadline");
		if (requestedDeadline) {
			const parsed = new Date(requestedDeadline);
			if (!Number.isNaN(parsed.getTime()))
				setDeadline(parsed.toISOString().slice(0, 16));
		}
	}, []);
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const { address, chainId } = useAccount();
	const { chainConfig } = useAppNetwork();
	const { switchChainAsync } = useSwitchChain();
	const client = usePublicClient({ chainId: chainConfig.id });
	const { writeContractAsync } = useWriteContract();
	const { signTypedDataAsync } = useSignTypedData();
	const { data: decimals } = useReadContract({
		address: chainConfig.usdgAddress,
		abi: erc20MetadataAbi,
		functionName: "decimals",
		chainId: chainConfig.id,
	});
	const { data: tokenSymbol } = useReadContract({
		address: chainConfig.usdgAddress,
		abi: erc20MetadataAbi,
		functionName: "symbol",
		chainId: chainConfig.id,
	});
	const { data: feeBps } = useReadContract({
		address: chainConfig.escrowAddress,
		abi: escrowAbi,
		functionName: "feeBps",
		chainId: chainConfig.id,
	});
	const { data: feeTreasury } = useReadContract({
		address: chainConfig.escrowAddress,
		abi: escrowAbi,
		functionName: "feeTreasury",
		chainId: chainConfig.id,
	});
	const register = useMutation(trpc.bounties.register.mutationOptions());
	const syncStatus = useMutation(trpc.bounties.syncStatus.mutationOptions());
	const createIssue = useMutation(trpc.bounties.createIssue.mutationOptions());
	const linkGitHubIssue = useMutation(
		trpc.bounties.linkGitHubIssue.mutationOptions(),
	);
	const repositories = useQuery(
		trpc.bounties.repositories.queryOptions(undefined, {
			enabled: !sessionPending && Boolean(session),
		}),
	);
	const deferredIssueSearch = useDeferredValue(issueSearch);
	const issues = useQuery(
		trpc.bounties.issues.queryOptions(
			{
				repository: repository || "invalid/repository",
				search: deferredIssueSearch,
			},
			{ enabled: Boolean(repository) && creationMode === "existing" },
		),
	);
	const selectedIssue = issues.data?.find(
		(issue) => String(issue.number) === issueNumber,
	);
	const rewardAmount = (() => {
		if (decimals === undefined || !amount) return BigInt(0);
		try {
			return parseUnits(amount, decimals);
		} catch {
			return BigInt(0);
		}
	})();
	const platformFeeBps = typeof feeBps === "number" ? feeBps : undefined;
	const feeAmount =
		platformFeeBps === undefined
			? BigInt(0)
			: (rewardAmount * BigInt(platformFeeBps)) / BigInt(10_000);
	const totalFunded = rewardAmount + feeAmount;

	function validate() {
		if (/^0x0{40}$/i.test(chainConfig.escrowAddress))
			return "Bounty funding is not enabled on this network yet.";
		if (!address)
			return "Connect and link your wallet before funding a bounty.";
		if (!repository) return "Select an installed GitHub repository.";
		if (creationMode === "existing" && !selectedIssue)
			return "Select an open GitHub issue from the searchable list.";
		if (creationMode === "new" && title.trim().length < 4)
			return "New issue title must be at least 4 characters.";
		if (!amount || !/^\d+(\.\d{1,18})?$/.test(amount) || Number(amount) <= 0)
			return "Enter a positive USDG reward amount.";
		const deadlineDate = new Date(deadline);
		if (
			Number.isNaN(deadlineDate.getTime()) ||
			deadlineDate.getTime() <= Date.now()
		)
			return "Choose a deadline in the future.";
		if (
			decimals === undefined ||
			tokenSymbol !== "USDG" ||
			platformFeeBps === undefined ||
			platformFeeBps > 500 ||
			!feeTreasury ||
			/^0x0{40}$/i.test(feeTreasury)
		)
			return "USDG metadata is not available yet. Try again shortly.";
		return null;
	}

	async function submit(event: React.FormEvent) {
		event.preventDefault();
		setError(null);
		const validationError = validate();
		if (validationError) return setError(validationError);
		if (
			!address ||
			!client ||
			decimals === undefined ||
			platformFeeBps === undefined
		)
			return;
		const selectedRepository = repositories.data?.find(
			(item) => item.fullName === repository,
		);
		if (!selectedRepository)
			return setError(
				"Repository authorization expired. Sync it again from Settings.",
			);
		if (chainId !== chainConfig.id)
			await switchChainAsync({ chainId: chainConfig.id });
		if (
			chainConfig.escrowAddress === "0x0000000000000000000000000000000000000000"
		)
			return setError(
				`${chainConfig.name} is available for wallets, but its PasinPay escrow contract has not been deployed yet.`,
			);

		try {
			let finalIssueNumber = Number(issueNumber);
			let finalIssueTitle = issueTitle || title.trim();
			let finalIssueUrl = issueUrl;
			if (creationMode === "new") {
				const createdIssue = await createIssue.mutateAsync({
					repository,
					title: title.trim(),
					body: issueBody.trim(),
				});
				finalIssueNumber = createdIssue.number;
				finalIssueTitle = createdIssue.title;
				finalIssueUrl = createdIssue.html_url;
			}
			if (!finalIssueNumber || !finalIssueUrl)
				throw new Error(
					"GitHub issue details are incomplete. Select or create the issue again.",
				);
			const rawAmount = rewardAmount;
			const repositoryHash = selectedRepository.repositoryHash as `0x${string}`;
			const deadlineSeconds = BigInt(
				Math.floor(new Date(deadline).getTime() / 1000),
			);
			setStep("creating");
			const creationHash = await writeWithFreshEip1559Fees(client, (fees) =>
				writeContractAsync({
					address: chainConfig.escrowAddress,
					abi: escrowAbi,
					functionName: "createBounty",
					args: [repositoryHash, finalIssueNumber, deadlineSeconds, BigInt(60)],
					...fees,
				}),
			);
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
				issueNumber: finalIssueNumber,
				issueTitle: finalIssueTitle,
				issueUrl: finalIssueUrl,
				creationMode,
				chainId: chainConfig.id as 421614 | 42161,
				title: `[PasinPay #${finalIssueNumber}] ${title.trim() || finalIssueTitle}`,
				amount: rawAmount.toString(),
				feeAmount: feeAmount.toString(),
				totalFunded: totalFunded.toString(),
				deadline: new Date(Number(deadlineSeconds) * 1000),
				reviewWindowSeconds: 60,
			});
			let fundingHash: `0x${string}`;
			if (chainConfig.id === 421614) {
				setStep("approving");
				const serverUrl = (process.env.NEXT_PUBLIC_SERVER_URL ?? "").replace(
					/\/$/,
					"",
				);
				const fundUrl = `${serverUrl}/api/x402/bounties/${registered.id}/fund`;
				const quoteResponse = await fetch(`${fundUrl}ing`, {
					cache: "no-store",
				});
				if (quoteResponse.status !== 402) {
					const quoteError = (await quoteResponse.json().catch(() => null)) as {
						error?: string;
					} | null;
					throw new Error(
						quoteError?.error ??
							"The Arbitrum Sepolia x402 quote is unavailable.",
					);
				}
				const quote = (await quoteResponse.json()) as {
					x402Version: number;
					resource: { url: string };
					accepts: Array<{
						scheme: string;
						network: string;
						amount: string;
						asset: `0x${string}`;
						payTo: `0x${string}`;
						maxTimeoutSeconds: number;
						extra: Record<string, unknown>;
					}>;
				};
				const accepted = quote.accepts[0];
				if (
					quote.x402Version !== 2 ||
					accepted?.scheme !== "exact" ||
					accepted.network !== `eip155:${chainConfig.id}` ||
					accepted.asset.toLowerCase() !==
						chainConfig.usdgAddress.toLowerCase() ||
					accepted.payTo.toLowerCase() !==
						chainConfig.escrowAddress.toLowerCase() ||
					BigInt(accepted.amount) !== totalFunded
				) {
					throw new Error("The x402 quote does not match this bounty.");
				}

				const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
				const validAfter = nowSeconds - BigInt(1);
				const validBefore = nowSeconds + BigInt(accepted.maxTimeoutSeconds);
				const authorizationNonce = keccak256(stringToHex(crypto.randomUUID()));
				const authorization = {
					from: address,
					to: chainConfig.escrowAddress,
					value: totalFunded,
					validAfter,
					validBefore,
					nonce: authorizationNonce,
				};
				const authorizationTypes = {
					TransferWithAuthorization: [
						{ name: "from", type: "address" },
						{ name: "to", type: "address" },
						{ name: "value", type: "uint256" },
						{ name: "validAfter", type: "uint256" },
						{ name: "validBefore", type: "uint256" },
						{ name: "nonce", type: "bytes32" },
					],
				} as const;
				const authorizationSignature = await signTypedDataAsync({
					domain: {
						name: "Global Dollar",
						version: "1",
						chainId: chainConfig.id,
						verifyingContract: chainConfig.usdgAddress,
					},
					types: authorizationTypes,
					primaryType: "TransferWithAuthorization",
					message: authorization,
				});
				const authorizationHash = keccak256(
					encodeAbiParameters(
						[
							{ type: "address" },
							{ type: "address" },
							{ type: "uint256" },
							{ type: "uint256" },
							{ type: "uint256" },
							{ type: "bytes32" },
						],
						[
							address,
							chainConfig.escrowAddress,
							totalFunded,
							validAfter,
							validBefore,
							authorizationNonce,
						],
					),
				);
				const intentDeadline = validBefore;
				const intentTypes = {
					X402Funding: [
						{ name: "bountyId", type: "uint256" },
						{ name: "payer", type: "address" },
						{ name: "rewardAmount", type: "uint128" },
						{ name: "feeAmount", type: "uint128" },
						{ name: "authorizationHash", type: "bytes32" },
						{ name: "intentDeadline", type: "uint64" },
					],
				} as const;
				const intent = {
					bountyId: created.args.bountyId,
					payer: address,
					rewardAmount: rawAmount,
					feeAmount,
					authorizationHash,
					intentDeadline,
				};
				const fundingIntentSignature = await signTypedDataAsync({
					domain: {
						name: "PasinPay",
						version: "1",
						chainId: chainConfig.id,
						verifyingContract: chainConfig.escrowAddress,
					},
					types: intentTypes,
					primaryType: "X402Funding",
					message: intent,
				});
				const paymentPayload = {
					x402Version: quote.x402Version,
					resource: { url: quote.resource.url },
					accepted,
					payload: {
						signature: authorizationSignature,
						authorization: {
							from: authorization.from,
							to: authorization.to,
							value: authorization.value.toString(),
							validAfter: authorization.validAfter.toString(),
							validBefore: authorization.validBefore.toString(),
							nonce: authorization.nonce,
						},
						fundingIntentSignature,
					},
				};
				const encodedPayload = btoa(
					String.fromCharCode(
						...new TextEncoder().encode(JSON.stringify(paymentPayload)),
					),
				);
				setStep("funding");
				let settlementResponse = await fetch(fundUrl, {
					method: "POST",
					headers: { "PAYMENT-SIGNATURE": encodedPayload },
					cache: "no-store",
				});
				let settlement = (await settlementResponse
					.json()
					.catch(() => null)) as {
					error?: string;
					status?: string;
					transaction?: `0x${string}`;
				} | null;
				for (
					let attempt = 0;
					attempt < 14 &&
					settlementResponse.status === 202 &&
					!settlement?.transaction;
					attempt++
				) {
					await new Promise((resolve) => setTimeout(resolve, 5_000));
					settlementResponse = await fetch(fundUrl, {
						method: "POST",
						headers: { "PAYMENT-SIGNATURE": encodedPayload },
						cache: "no-store",
					});
					settlement = (await settlementResponse
						.json()
						.catch(() => null)) as typeof settlement;
				}
				if (
					settlementResponse.status === 503 &&
					settlement?.error?.includes("relayer is not configured")
				) {
					// The wallet acts as the testnet relayer when the hosted relayer key
					// has not been configured. The same signed x402 authorization is used.
					setStep("funding");
					fundingHash = await writeWithFreshEip1559Fees(client, (fees) =>
						writeContractAsync({
							address: chainConfig.escrowAddress,
							abi: escrowAbi,
							functionName: "fundBountyWithX402",
							args: [
								created.args.bountyId,
								rawAmount,
								validAfter,
								validBefore,
								authorizationNonce,
								authorizationSignature,
								intentDeadline,
								fundingIntentSignature,
							],
							...fees,
						}),
					);
				} else {
					if (!settlementResponse.ok || !settlement?.transaction) {
						throw new Error(
							settlement?.error ??
								"PasinPay could not confirm the x402 settlement yet. Check this bounty's on-chain status before taking another payment action.",
						);
					}
					fundingHash = settlement.transaction;
				}
			} else {
				setStep("approving");
				const approvalHash = await writeWithFreshEip1559Fees(client, (fees) =>
					writeContractAsync({
						address: chainConfig.usdgAddress,
						abi: erc20ApproveAbi,
						functionName: "approve",
						args: [chainConfig.escrowAddress, totalFunded],
						...fees,
					}),
				);
				await client.waitForTransactionReceipt({ hash: approvalHash });
				setStep("funding");
				fundingHash = await writeWithFreshEip1559Fees(client, (fees) =>
					writeContractAsync({
						address: chainConfig.escrowAddress,
						abi: escrowAbi,
						functionName: "fundBounty",
						args: [created.args.bountyId, rawAmount],
						...fees,
					}),
				);
			}
			await client.waitForTransactionReceipt({ hash: fundingHash });
			await syncStatus.mutateAsync({
				onchainBountyId: created.args.bountyId.toString(),
				status: "Funded",
			});
			try {
				await linkGitHubIssue.mutateAsync({
					repository,
					issueNumber: finalIssueNumber,
					title: `[PasinPay #${finalIssueNumber}] ${title.trim() || finalIssueTitle}`,
					bountyUrl: `${window.location.origin}/bounties/${registered.id}`,
				});
			} catch {
				// The bounty is already funded; a retry can be performed without risking funds.
			}
			window.location.href = `/bounties/${registered.id}`;
		} catch (cause) {
			setStep("idle");
			setError(
				getReadableError(cause, "The transaction could not be completed."),
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
						Choose an existing GitHub issue or create one as part of the bounty.
						USDG is locked only after the issue is mapped to the on-chain
						escrow.
					</p>
					<form className="mt-8 flex flex-col gap-6" onSubmit={submit}>
						<Card>
							<CardHeader>
								<CardTitle>Task details</CardTitle>
								<CardDescription>
									GitHub evidence and the escrow record stay linked from
									creation onward.
								</CardDescription>
							</CardHeader>
							<CardContent className="grid gap-5 sm:grid-cols-2">
								<div className="flex flex-col gap-2 sm:col-span-2">
									<Label>Creation mode</Label>
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											variant={
												creationMode === "existing" ? "secondary" : "outline"
											}
											onClick={() => {
												setCreationMode("existing");
												setIssueBody("");
											}}
										>
											<Search data-icon="inline-start" /> Use an existing issue
										</Button>
										<Button
											type="button"
											size="sm"
											variant={creationMode === "new" ? "secondary" : "outline"}
											onClick={() => {
												setCreationMode("new");
												setIssueNumber("");
												setIssueTitle("");
												setIssueUrl("");
											}}
										>
											<Plus data-icon="inline-start" /> Create a new issue
										</Button>
									</div>
								</div>
								<div className="flex flex-col gap-2 sm:col-span-2">
									<Label htmlFor="repository">Repository</Label>
									<Select
										value={repository}
										onValueChange={(value) => {
											setRepository(value ?? "");
											setIssueNumber("");
											setIssueTitle("");
											setIssueUrl("");
										}}
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
								{creationMode === "existing" ? (
									<div className="flex flex-col gap-2 sm:col-span-2">
										<Label>GitHub issue</Label>
										<Popover
											open={issuePickerOpen}
											onOpenChange={setIssuePickerOpen}
										>
											<PopoverTrigger
												render={
													<Button
														type="button"
														variant="outline"
														className="w-full justify-between"
														disabled={!repository}
													/>
												}
											>
												{selectedIssue
													? `#${selectedIssue.number} ${selectedIssue.title}`
													: repository
														? "Search open issues"
														: "Select a repository first"}
												<ChevronDown data-icon="inline-end" />
											</PopoverTrigger>
											<PopoverContent
												align="start"
												className="w-[min(520px,calc(100vw-2rem))]"
											>
												<div className="flex items-center gap-2 border-b pb-2">
													<Search className="size-4 text-muted-foreground" />
													<Input
														autoFocus
														placeholder="Search issue number or title"
														value={issueSearch}
														onChange={(event) =>
															setIssueSearch(event.target.value)
														}
													/>
												</div>
												<ScrollArea className="h-64">
													<div className="flex flex-col gap-1 py-2">
														{issues.isLoading ? (
															<p className="px-2 py-4 text-muted-foreground">
																Loading issues…
															</p>
														) : issues.data?.length ? (
															issues.data.map((issue) => (
																<Button
																	key={issue.number}
																	type="button"
																	variant="ghost"
																	className="h-auto justify-start whitespace-normal text-left"
																	onClick={() => {
																		setIssueNumber(String(issue.number));
																		setIssueTitle(issue.title);
																		setIssueUrl(issue.html_url);
																		setTitle(issue.title);
																		setIssuePickerOpen(false);
																	}}
																>
																	<span className="font-mono text-muted-foreground">
																		#{issue.number}
																	</span>
																	<span>{issue.title}</span>
																</Button>
															))
														) : (
															<p className="px-2 py-4 text-muted-foreground">
																No open issues match this search.
															</p>
														)}
													</div>
												</ScrollArea>
											</PopoverContent>
										</Popover>
										{selectedIssue && (
											<a
												className="inline-flex items-center gap-1 text-muted-foreground text-xs underline"
												href={selectedIssue.html_url}
												target="_blank"
												rel="noreferrer"
											>
												Open issue <ExternalLink className="size-3" />
											</a>
										)}
									</div>
								) : (
									<div className="flex flex-col gap-2 sm:col-span-2">
										<Label htmlFor="issue-body">New issue description</Label>
										<Textarea
											id="issue-body"
											placeholder="Describe the feature or fix for contributors…"
											value={issueBody}
											onChange={(event) => setIssueBody(event.target.value)}
										/>
									</div>
								)}
								<div className="flex flex-col gap-2 sm:col-span-2">
									<Label htmlFor="title">Bounty title</Label>
									<Input
										id="title"
										placeholder="Fix checkout timeout"
										value={title}
										onChange={(event) => setTitle(event.target.value)}
										required
									/>
								</div>
								<div className="flex flex-col gap-2">
									<Label htmlFor="amount">Reward in USDG</Label>
									<Input
										id="amount"
										inputMode="decimal"
										min="0.000001"
										step="any"
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
							<Button
								type="submit"
								size="lg"
								disabled={step !== "idle" || createIssue.isPending}
							>
								{step === "creating" ? (
									"Creating bounty…"
								) : step === "approving" ? (
									"Approve USDG…"
								) : step === "funding" ? (
									"Funding bounty…"
								) : (
									<>
										Fund ${amount || "0"} USDG + fee{" "}
										<ArrowRight data-icon="inline-end" />
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
								{repository || "owner/repository"}
								{creationMode === "existing" &&
									issueNumber &&
									` · Issue #${issueNumber}`}
							</p>
						</div>
						<div className="space-y-2 border-t pt-5 text-sm">
							<div className="flex justify-between gap-4">
								<span className="text-muted-foreground">
									Contributor reward
								</span>
								<span className="font-semibold">{amount || "0"} USDG</span>
							</div>
							<div className="flex justify-between gap-4 text-muted-foreground">
								<span>
									Platform fee ({((platformFeeBps ?? 250) / 100).toFixed(2)}%)
								</span>
								<span>
									{decimals === undefined
										? "—"
										: `${formatUnits(feeAmount, decimals)} USDG`}
								</span>
							</div>
							<div className="flex justify-between gap-4 border-t pt-2 font-semibold">
								<span>Total creator funding</span>
								<span>
									{decimals === undefined
										? "—"
										: `${formatUnits(totalFunded, decimals)} USDG`}
								</span>
							</div>
						</div>
						<div className="flex flex-col gap-3 border-t pt-5 text-muted-foreground text-sm">
							<span className="flex items-center gap-2">
								<GitBranch className="size-4" /> Merged pull request
							</span>
							<span className="flex items-center gap-2">
								<LockKeyhole className="size-4" /> Non-custodial escrow
							</span>
							<span className="flex items-center gap-2">
								<WalletCards className="size-4" /> {chainConfig.name} · fee
								protected by escrow
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
