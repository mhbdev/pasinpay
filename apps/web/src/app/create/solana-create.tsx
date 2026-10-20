"use client";

import {
	createAssociatedTokenAccountIdempotentInstruction,
	createBountyInstruction,
	createFundBountyInstruction,
	decodeSolanaBountyAccount,
	fetchSolanaEscrowConfig,
	hexToBytes,
	SOLANA_DEVNET_ID,
} from "@pasinpay/solana";
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
import { Switch } from "@pasinpay/ui/components/switch";
import { Textarea } from "@pasinpay/ui/components/textarea";
import { address, getBase64Encoder } from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
	ArrowRight,
	ExternalLink,
	LoaderCircle,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AuthGuard } from "@/components/auth-guard";
import { authClient } from "@/lib/auth-client";
import { getReadableError } from "@/lib/errors";
import { solanaClient } from "@/lib/solana-client";
import {
	createDevnetRpc,
	sendSolanaInstructions,
} from "@/lib/solana-transactions";
import { trpc } from "@/utils/trpc";

type CreationMode = "existing" | "new";

function parseUsdcAmount(value: string) {
	if (!/^\d+(\.\d{1,6})?$/.test(value))
		throw new Error(
			"Enter a positive USDC amount with at most six decimal places.",
		);
	const [whole, fraction = ""] = value.split(".");
	return (
		BigInt(whole ?? "0") * BigInt(1_000_000) +
		BigInt(fraction.padEnd(6, "0") || "0")
	);
}

function LocalDateTimeDefault() {
	return new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 16);
}

export default function SolanaCreateBountyPage() {
	const router = useRouter();
	const { data: session } = authClient.useSession();
	const connected = useConnectedWallet(solanaClient);
	const network = useQuery(trpc.bounties.solanaDevnetConfig.queryOptions());
	const linkedWallets = useQuery(
		trpc.bounties.walletLink.queryOptions(undefined, {
			enabled: Boolean(session),
		}),
	);
	const repositories = useQuery(
		trpc.bounties.repositories.queryOptions(undefined, {
			enabled: Boolean(session),
		}),
	);
	const [mode, setMode] = useState<CreationMode>("existing");
	const [repository, setRepository] = useState("");
	const [issueNumber, setIssueNumber] = useState("");
	const [issueSearch, setIssueSearch] = useState("");
	const [title, setTitle] = useState("");
	const [issueTitle, setIssueTitle] = useState("");
	const [issueBody, setIssueBody] = useState("");
	const [amount, setAmount] = useState("");
	const [deadline, setDeadline] = useState(LocalDateTimeDefault);
	const [privateBounty, setPrivateBounty] = useState(false);
	const [joiningPassword, setJoiningPassword] = useState("");
	const [busy, setBusy] = useState<
		"idle" | "creating" | "registering" | "funding"
	>("idle");
	const [error, setError] = useState<string | null>(null);
	const createIssue = useMutation(trpc.bounties.createIssue.mutationOptions());
	const register = useMutation(trpc.bounties.register.mutationOptions());
	const linkGitHubIssue = useMutation(
		trpc.bounties.linkGitHubIssue.mutationOptions(),
	);
	const issues = useQuery(
		trpc.bounties.issues.queryOptions(
			{ repository: repository || "invalid/repository", search: issueSearch },
			{ enabled: Boolean(repository) && mode === "existing" },
		),
	);
	const privacy = useMutation(
		trpc.bounties.repositoryPrivacy.mutationOptions(),
	);
	const selectedRepository = repositories.data?.find(
		(item) => item.fullName === repository,
	);
	const selectedIssue = issues.data?.find(
		(item) => String(item.number) === issueNumber,
	);
	const linkedSolanaAddress = linkedWallets.data?.find(
		(item) => item.chainId === SOLANA_DEVNET_ID,
	)?.walletAddress;
	const feeBps = network.data?.feeBps;
	const reward = useMemo(() => {
		try {
			return amount ? parseUsdcAmount(amount) : BigInt(0);
		} catch {
			return BigInt(0);
		}
	}, [amount]);
	const fee =
		feeBps === undefined
			? BigInt(0)
			: (reward * BigInt(feeBps)) / BigInt(10_000);

	async function submit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		setError(null);
		let registeredId: string | undefined;
		try {
			if (!session)
				throw new Error("Sign in with GitHub before creating a bounty.");
			if (!connected?.signer)
				throw new Error("Connect a Solana Devnet wallet first.");
			if (!network.data?.programId)
				throw new Error(
					"Solana Devnet escrow is not deployed and configured yet.",
				);
			if (!selectedRepository)
				throw new Error("Select an installed GitHub repository.");
			if (linkedSolanaAddress !== connected.account.address)
				throw new Error(
					"Link this exact Solana wallet to your PasinPay account in Settings before creating a bounty.",
				);
			if (
				privateBounty &&
				(joiningPassword.length < 12 || joiningPassword.length > 128)
			)
				throw new Error("Private bounty passwords must be 12–128 characters.");
			if (reward <= BigInt(0))
				throw new Error("Enter a positive USDC reward amount.");
			if (feeBps === undefined || feeBps > 500)
				throw new Error(
					"The configured Solana platform fee is unavailable or invalid.",
				);
			if (new Date(deadline).getTime() <= Date.now())
				throw new Error("Choose a deadline in the future.");
			if (mode === "existing" && !selectedIssue)
				throw new Error("Select an open GitHub issue.");
			if (mode === "new" && issueTitle.trim().length < 4)
				throw new Error("New issue title must be at least four characters.");
			if (privateBounty) {
				const { isPrivate } = await privacy.mutateAsync({ repository });
				if (!isPrivate)
					throw new Error(
						"Password-protected bounties require a private GitHub repository.",
					);
			}
			let finalIssueNumber = Number(issueNumber);
			let finalIssueTitle = selectedIssue?.title ?? issueTitle.trim();
			let finalIssueUrl = selectedIssue?.html_url ?? "";
			if (mode === "new") {
				const created = await createIssue.mutateAsync({
					repository,
					title: issueTitle.trim(),
					body: issueBody.trim(),
				});
				finalIssueNumber = created.number;
				finalIssueTitle = created.title;
				finalIssueUrl = created.html_url;
			}
			if (!finalIssueNumber || !finalIssueUrl)
				throw new Error("GitHub issue information is incomplete.");

			setBusy("creating");
			const { rpc } = createDevnetRpc();
			const onchainConfig = await fetchSolanaEscrowConfig(
				rpc,
				network.data.programId,
			);
			if (!onchainConfig)
				throw new Error(
					"The Solana escrow configuration account is missing; deployment initialization is incomplete.",
				);
			if (onchainConfig.mint !== network.data.tokenAddress)
				throw new Error(
					"The deployed program is not configured for the official Solana Devnet USDC mint.",
				);
			if (
				onchainConfig.feeBps !== feeBps ||
				onchainConfig.feeTreasury !== network.data.feeTreasury
			)
				throw new Error(
					"Server and on-chain Solana fee settings are not aligned; bounty creation is disabled.",
				);
			const deadlineSeconds = BigInt(
				Math.floor(new Date(deadline).getTime() / 1000),
			);
			const created = await createBountyInstruction({
				programId: network.data.programId,
				creator: connected.account.address,
				config: onchainConfig,
				repositoryHash: hexToBytes(selectedRepository.repositoryHash, 32),
				issueNumber: finalIssueNumber,
				deadline: deadlineSeconds,
				reviewWindow: BigInt(60),
			});
			await sendSolanaInstructions({
				feePayer: connected.signer,
				instructions: [created.instruction],
			});
			const { value: accountInfo } = await rpc
				.getAccountInfo(address(created.bountyAddress), {
					commitment: "confirmed",
					encoding: "base64",
				})
				.send();
			if (!accountInfo || accountInfo.owner !== address(network.data.programId))
				throw new Error(
					"Bounty creation was confirmed but the new escrow account could not be verified.",
				);
			const repositoryHashBytes = hexToBytes(
				selectedRepository.repositoryHash,
				32,
			);
			const verified = decodeSolanaBountyAccount(
				new Uint8Array(getBase64Encoder().encode(accountInfo.data[0])),
			);
			if (
				verified.id !== created.bountyId ||
				verified.creator !== connected.account.address ||
				verified.issueNumber !== finalIssueNumber ||
				verified.repositoryHash.some(
					(byte, index) => byte !== repositoryHashBytes[index],
				)
			)
				throw new Error(
					"The created on-chain bounty does not match the selected issue and wallet.",
				);

			setBusy("registering");
			const id = crypto.randomUUID();
			const repoHash = selectedRepository.repositoryHash;
			const titleText = `[PasinPay #${finalIssueNumber}] ${title.trim() || finalIssueTitle}`;
			registeredId = id;
			const registered = await register.mutateAsync({
				id,
				onchainBountyId: created.bountyId.toString(),
				creatorWallet: connected.account.address,
				repository,
				repositoryHash: repoHash,
				issueNumber: finalIssueNumber,
				issueTitle: finalIssueTitle,
				issueUrl: finalIssueUrl,
				creationMode: mode,
				chainId: SOLANA_DEVNET_ID,
				title: titleText,
				amount: reward.toString(),
				feeAmount: fee.toString(),
				totalFunded: (reward + fee).toString(),
				deadline: new Date(Number(deadlineSeconds) * 1000),
				reviewWindowSeconds: 60,
				...(privateBounty ? { joiningPassword } : {}),
			});
			registeredId = registered.id;
			try {
				await linkGitHubIssue.mutateAsync({
					repository,
					issueNumber: finalIssueNumber,
					title: titleText,
					bountyUrl: `${window.location.origin}/bounties/${registered.id}`,
				});
			} catch {
				toast.warning(
					"The bounty was created, but GitHub could not be updated with its PasinPay link.",
				);
			}

			setBusy("funding");
			const fund = await createFundBountyInstruction({
				programId: network.data.programId,
				creator: connected.account.address,
				bountyId: created.bountyId,
				rewardAmount: reward,
				mint: onchainConfig.mint,
			});
			const createCreatorAta =
				createAssociatedTokenAccountIdempotentInstruction({
					payer: connected.account.address,
					owner: connected.account.address,
					mint: onchainConfig.mint,
					tokenAccount: fund.creatorTokenAddress,
				});
			await sendSolanaInstructions({
				feePayer: connected.signer,
				instructions: [createCreatorAta, fund.instruction],
			});
			const { value: fundedInfo } = await rpc
				.getAccountInfo(address(created.bountyAddress), {
					commitment: "confirmed",
					encoding: "base64",
				})
				.send();
			if (!fundedInfo)
				throw new Error(
					"Funding was confirmed but the escrow account could not be read back.",
				);
			const funded = decodeSolanaBountyAccount(
				new Uint8Array(getBase64Encoder().encode(fundedInfo.data[0])),
			);
			if (
				funded.status !== "Funded" ||
				funded.amount !== reward ||
				funded.feeAmount !== fee ||
				funded.totalFunded !== reward + fee
			)
				throw new Error(
					"Funding transaction confirmed, but the on-chain status or reward/fee totals did not match.",
				);
			toast.success("Solana Devnet bounty created and funded.");
			router.push(`/bounties/${registered.id}`);
		} catch (cause) {
			if (registeredId) {
				toast.error(
					"The bounty is on-chain, but funding or verification needs attention. You can continue from the bounty page.",
				);
				router.push(`/bounties/${registeredId}?funding=pending`);
				return;
			}
			setError(getReadableError(cause, "Solana bounty creation failed."));
			setBusy("idle");
		}
	}

	return (
		<AuthGuard>
			<main className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[minmax(0,1fr)_360px]">
				<div className="space-y-6">
					<div>
						<p className="text-muted-foreground text-sm">
							SOLANA DEVNET · TESTNET
						</p>
						<h1 className="mt-2 font-semibold text-4xl tracking-tight">
							Fund GitHub work
						</h1>
						<p className="mt-3 max-w-2xl text-muted-foreground">
							Create a bounty against a GitHub issue and lock Devnet USDC in a
							Solana program-derived escrow. Mainnet is not enabled.
						</p>
					</div>
					<Card>
						<CardHeader>
							<CardTitle>Task details</CardTitle>
							<CardDescription>
								The issue, claimant evidence, wallet, and escrow are linked from
								creation onward.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<form className="space-y-5" onSubmit={submit}>
								<div className="grid gap-3 sm:grid-cols-2">
									<Button
										type="button"
										variant={mode === "existing" ? "default" : "outline"}
										onClick={() => setMode("existing")}
									>
										Use an existing issue
									</Button>
									<Button
										type="button"
										variant={mode === "new" ? "default" : "outline"}
										onClick={() => setMode("new")}
									>
										Create a new issue
									</Button>
								</div>
								<div className="space-y-2">
									<Label htmlFor="solana-repository">Repository</Label>
									<select
										id="solana-repository"
										className="h-10 w-full rounded-md border bg-background px-3 text-sm"
										value={repository}
										onChange={(event) => {
											setRepository(event.target.value);
											setIssueNumber("");
										}}
									>
										<option value="">Select an installed repository</option>
										{repositories.data?.map((item) => (
											<option key={item.id} value={item.fullName}>
												{item.fullName}
											</option>
										))}
									</select>
									{repositories.data?.length === 0 && (
										<p className="text-muted-foreground text-sm">
											No installed repositories. Sync them in{" "}
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
								{mode === "existing" ? (
									<div className="space-y-2">
										<Label htmlFor="solana-issue-search">
											Open GitHub issue
										</Label>
										<Input
											id="solana-issue-search"
											placeholder="Search by issue number or title"
											value={issueSearch}
											onChange={(event) => setIssueSearch(event.target.value)}
											disabled={!repository}
										/>
										<select
											aria-label="Select GitHub issue"
											className="h-10 w-full rounded-md border bg-background px-3 text-sm"
											value={issueNumber}
											onChange={(event) => {
												const issue = issues.data?.find(
													(item) => String(item.number) === event.target.value,
												);
												setIssueNumber(event.target.value);
												setIssueTitle(issue?.title ?? "");
											}}
											disabled={!repository}
										>
											<option value="">Select an open issue</option>
											{issues.data?.map((issue) => (
												<option key={issue.number} value={issue.number}>
													#{issue.number} · {issue.title}
												</option>
											))}
										</select>
									</div>
								) : (
									<div className="space-y-2">
										<Label htmlFor="solana-issue-title">New issue title</Label>
										<Input
											id="solana-issue-title"
											value={issueTitle}
											onChange={(event) => setIssueTitle(event.target.value)}
											minLength={4}
											maxLength={200}
											required
										/>
										<Label htmlFor="solana-issue-body">Issue description</Label>
										<Textarea
											id="solana-issue-body"
											value={issueBody}
											onChange={(event) => setIssueBody(event.target.value)}
											maxLength={20_000}
											rows={5}
										/>
									</div>
								)}
								<div className="space-y-2">
									<Label htmlFor="solana-bounty-title">Bounty title</Label>
									<Input
										id="solana-bounty-title"
										value={title}
										onChange={(event) => setTitle(event.target.value)}
										maxLength={200}
										placeholder="Optional title; defaults to the issue title"
									/>
								</div>
								<div className="grid gap-4 sm:grid-cols-2">
									<div className="space-y-2">
										<Label htmlFor="solana-reward">Reward in USDC</Label>
										<Input
											id="solana-reward"
											value={amount}
											onChange={(event) => setAmount(event.target.value)}
											inputMode="decimal"
											placeholder="25.00"
											required
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="solana-deadline">Deadline</Label>
										<Input
											id="solana-deadline"
											type="datetime-local"
											value={deadline}
											onChange={(event) => setDeadline(event.target.value)}
											required
										/>
									</div>
								</div>
								<div className="rounded-md border p-4">
									<div className="flex items-center justify-between gap-4">
										<div>
											<Label htmlFor="solana-private">
												Password-protected bounty
											</Label>
											<p className="mt-1 text-muted-foreground text-sm">
												Requires a private GitHub repository and verified
												participant membership.
											</p>
										</div>
										<Switch
											id="solana-private"
											checked={privateBounty}
											onCheckedChange={setPrivateBounty}
										/>
									</div>
									{privateBounty && (
										<div className="mt-4 space-y-2">
											<Label htmlFor="solana-password">Joining password</Label>
											<Input
												id="solana-password"
												type="password"
												autoComplete="new-password"
												minLength={12}
												maxLength={128}
												value={joiningPassword}
												onChange={(event) =>
													setJoiningPassword(event.target.value)
												}
												required
											/>
										</div>
									)}
								</div>
								{error && (
									<p
										role="alert"
										className="rounded-md bg-destructive/10 p-3 text-destructive text-sm"
									>
										{error}
									</p>
								)}
								<Button
									type="submit"
									disabled={
										busy !== "idle" ||
										register.isPending ||
										createIssue.isPending ||
										!session
									}
									className="w-full"
								>
									{busy === "idle" ? (
										`Create & fund ${amount || "0"} USDC`
									) : (
										<>
											<LoaderCircle className="animate-spin" />
											{busy === "creating"
												? "Waiting for creation confirmation…"
												: busy === "registering"
													? "Saving bounty details…"
													: "Waiting for USDC funding confirmation…"}
										</>
									)}
									<ArrowRight data-icon="inline-end" />
								</Button>
							</form>
						</CardContent>
					</Card>
				</div>
				<aside className="h-fit space-y-4 lg:sticky lg:top-8">
					<Card>
						<CardHeader>
							<CardTitle>Funding summary</CardTitle>
							<CardDescription>
								{repository || "Select a repository"}
								{issueNumber ? ` · Issue #${issueNumber}` : ""}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3 text-sm">
							<div className="flex justify-between">
								<span>Contributor reward</span>
								<span>{amount || "0"} USDC</span>
							</div>
							<div className="flex justify-between text-muted-foreground">
								<span>Platform fee ({feeBps ?? 0} bps)</span>
								<span>{Number(fee) / 1_000_000} USDC</span>
							</div>
							<div className="flex justify-between border-t pt-3 font-medium">
								<span>Total locked</span>
								<span>{Number(reward + fee) / 1_000_000} USDC</span>
							</div>
							<p className="flex items-center gap-2 pt-2 text-muted-foreground">
								<ShieldCheck className="size-4" /> Held in a non-custodial
								Solana escrow.
							</p>
							<a
								className="inline-flex items-center gap-1 underline underline-offset-4"
								href="https://faucet.circle.com/?chain=SOL"
								target="_blank"
								rel="noreferrer"
							>
								Circle Devnet USDC faucet <ExternalLink className="size-3" />
							</a>
							<p className="text-muted-foreground text-xs">
								The Circle faucet has wallet eligibility and rate limits. You
								also need Devnet SOL to pay transaction fees.
							</p>
						</CardContent>
					</Card>
					{connected?.account.address && (
						<p className="break-all text-muted-foreground text-xs">
							Connected Solana wallet:{" "}
							<span className="font-mono">{connected.account.address}</span>
						</p>
					)}
				</aside>
			</main>
		</AuthGuard>
	);
}
