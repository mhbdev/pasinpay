"use client";

import {
	bigintToLittleEndian,
	bytesToHex,
	createAssociatedTokenAccountIdempotentInstruction,
	createClaimInstruction,
	createCreatorActionInstruction,
	createEd25519VerificationInstruction,
	createFinalizeClaimInstruction,
	createFundBountyInstruction,
	createRefundExpiredInstruction,
	createResolveDisputeInstruction,
	decodeSolanaBountyAccount,
	deriveAssociatedTokenAddress,
	deriveBountyAddress,
	encodeSolanaClaimMessage,
	fetchSolanaEscrowConfig,
	hexToBytes,
	SOLANA_DEVNET_ID,
	SOLANA_DEVNET_NETWORK_DOMAIN,
	SOLANA_DEVNET_USDC_MINT,
	type SolanaBountyState,
	solanaExplorerAddressUrl,
	solanaExplorerTransactionUrl,
} from "@pasinpay/solana";
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
	CardDescription,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import {
	address,
	assertIsSignatureBytes,
	getBase58Encoder,
	getBase64Encoder,
	getPublicKeyFromAddress,
	verifySignature,
} from "@solana/kit";
import { useConnectedWallet } from "@solana/kit-plugin-wallet/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
	ArrowUpRight,
	CheckCircle2,
	Clock3,
	ExternalLink,
	LoaderCircle,
	ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { NetworkBadge } from "@/components/network-badge";
import { useAppNetwork } from "@/components/network-provider";
import { getReadableError } from "@/lib/errors";
import { solanaClient } from "@/lib/solana-client";
import {
	createDevnetRpc,
	sendSolanaInstructions,
} from "@/lib/solana-transactions";
import { trpc } from "@/utils/trpc";

type SolanaBountyRecord = {
	id: string;
	title: string;
	repository: string;
	repositoryHash: string;
	issueNumber: number;
	issueTitle: string;
	issueUrl: string;
	creatorWallet: string;
	amount: string;
	feeAmount: string;
	totalFunded: string;
	deadline: string | Date;
	reviewWindowSeconds: number;
	reviewEnds: string | Date | null;
	onchainBountyId: string | null;
	status: string;
	creator: {
		name: string;
		image: string | null;
		wallet: string;
		githubUrl: string | null;
	};
	chain: {
		id: number;
		name: string;
		escrowAddress: string;
		tokenAddress: string;
		tokenSymbol: string;
		feeTreasury: string;
		feeBps: number;
		explorerUrl: string;
	};
	pullRequests: Array<{
		number: number;
		title: string;
		htmlUrl: string;
		authorLogin: string | null;
		status: string;
		mergedAt: string | null;
	}>;
	claims: Array<{
		githubPrNumber: number;
		claimantWallet: string;
		mergeCommitSha: string;
		attestationSignature: string;
		attestationNonce: string;
		attestationExpiresAt: string | Date;
		attestationDigest: string;
		evidence: Record<string, unknown>;
	}>;
	settlement: {
		recipient: string;
		amount: string;
		feeAmount: string;
		transactionHash: string;
	} | null;
};

type ClaimAttestation = {
	githubPrNumber: number;
	claimantWallet: string;
	mergeCommitSha: string;
	attestationSignature: string;
	attestationNonce: string;
	attestationExpiresAt: string | Date;
	attestationDigest: string;
} | null;

function usdc(value: bigint | string) {
	const integer = typeof value === "bigint" ? value : BigInt(value);
	const amount = Number(integer) / 1_000_000;
	return `${amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} USDC`;
}

function decodeAccount(encoded: string) {
	return new Uint8Array(getBase64Encoder().encode(encoded));
}

function statusTone(status: string) {
	if (status === "Paid") return "default" as const;
	if (status === "Funded" || status === "ClaimPending")
		return "secondary" as const;
	if (status === "Disputed" || status === "Refunded" || status === "Cancelled")
		return "destructive" as const;
	return "outline" as const;
}

export function SolanaBountyDetail({
	bounty,
	claim,
}: {
	bounty: SolanaBountyRecord;
	claim: ClaimAttestation;
}) {
	const { selectNetwork, networkId } = useAppNetwork();
	const connected = useConnectedWallet(solanaClient);
	const queryClient = useQueryClient();
	const [busy, setBusy] = useState<string | null>(null);
	const [lastSignature, setLastSignature] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [claimantBps, setClaimantBps] = useState("10000");
	const network = useQuery(trpc.bounties.solanaDevnetConfig.queryOptions());
	const onchainConfigQuery = useQuery({
		queryKey: ["solana-config-account", bounty.chain.escrowAddress],
		enabled: Boolean(network.data?.programId),
		refetchInterval: 30_000,
		queryFn: () => {
			const programId = network.data?.programId;
			if (!programId) return null;
			return fetchSolanaEscrowConfig(createDevnetRpc().rpc, programId);
		},
	});
	const wallets = useQuery(
		trpc.bounties.walletLink.queryOptions(undefined, {
			enabled: Boolean(connected),
		}),
	);
	const addressMatchesBounty = Boolean(
		connected?.account.address &&
			connected.account.address === bounty.creatorWallet,
	);
	const linkedAddress = wallets.data?.find(
		(item) => item.chainId === SOLANA_DEVNET_ID,
	)?.walletAddress;
	const hasLinkedActiveWallet = Boolean(
		connected?.account.address && linkedAddress === connected.account.address,
	);
	const bountyAddressQuery = useQuery({
		queryKey: [
			"solana-bounty-account",
			bounty.chain.escrowAddress,
			bounty.onchainBountyId,
		],
		enabled: Boolean(
			bounty.onchainBountyId &&
				network.data?.programId === bounty.chain.escrowAddress,
		),
		refetchInterval: 4_000,
		queryFn: async (): Promise<SolanaBountyState | null> => {
			if (!bounty.onchainBountyId || !network.data?.programId) return null;
			const { rpc } = createDevnetRpc();
			const accountAddress = await deriveBountyAddress(
				network.data.programId,
				BigInt(bounty.onchainBountyId),
			);
			const { value } = await rpc
				.getAccountInfo(address(accountAddress), {
					commitment: "confirmed",
					encoding: "base64",
				})
				.send();
			if (!value) return null;
			if (value.owner !== address(network.data.programId))
				throw new Error(
					"Bounty account is not owned by the configured Solana escrow program.",
				);
			const state = decodeSolanaBountyAccount(decodeAccount(value.data[0]));
			if (
				state.id !== BigInt(bounty.onchainBountyId) ||
				state.creator !== bounty.creatorWallet
			)
				throw new Error(
					"On-chain bounty identity does not match the indexed bounty.",
				);
			return state;
		},
	});
	const onchain = bountyAddressQuery.data;
	const status =
		onchain?.status ?? (bounty.onchainBountyId ? "Loading" : bounty.status);
	const creatorMayAct = Boolean(
		addressMatchesBounty && connected?.signer && hasLinkedActiveWallet,
	);
	const claimIsForConnectedWallet = Boolean(
		claim &&
			connected?.account.address === claim.claimantWallet &&
			hasLinkedActiveWallet,
	);
	const bountyPdaQuery = useQuery({
		queryKey: [
			"solana-bounty-pda",
			bounty.chain.escrowAddress,
			bounty.onchainBountyId,
		],
		enabled: Boolean(bounty.onchainBountyId),
		queryFn: () =>
			bounty.onchainBountyId
				? deriveBountyAddress(
						bounty.chain.escrowAddress,
						BigInt(bounty.onchainBountyId),
					)
				: Promise.resolve(null),
	});
	const explorerAddress = bountyPdaQuery.data ?? bounty.chain.escrowAddress;
	const claimRecord = claim ?? bounty.claims[0] ?? null;
	const normalizedClaimBps = Number(claimantBps);
	const canResolveDispute = Boolean(
		onchain?.status === "Disputed" &&
			connected?.account.address === onchainConfigQuery.data?.authority &&
			connected?.signer &&
			Number.isInteger(normalizedClaimBps) &&
			normalizedClaimBps >= 0 &&
			normalizedClaimBps <= 10_000,
	);

	async function readVerifiedState() {
		const state = await bountyAddressQuery.refetch();
		if (!state.data)
			throw new Error(
				"Confirmed transaction did not produce a readable bounty account.",
			);
		return state.data;
	}

	async function submitInstructions(
		label: string,
		instructions: Parameters<typeof sendSolanaInstructions>[0]["instructions"],
		expectedStatus: string,
	) {
		if (!connected?.signer || !connected.account.address)
			throw new Error("Connect a signing-capable Solana wallet.");
		setBusy(label);
		setActionError(null);
		try {
			const signature = await sendSolanaInstructions({
				feePayer: connected.signer,
				instructions,
			});
			setLastSignature(signature);
			const state = await readVerifiedState();
			if (state.status !== expectedStatus)
				throw new Error(
					`Transaction confirmed, but escrow state is ${state.status}; expected ${expectedStatus}. The UI has not marked the action complete.`,
				);
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: trpc.bounties.getById.queryKey({ id: bounty.id }),
				}),
				queryClient.invalidateQueries({
					queryKey: trpc.bounties.claim.queryKey({ bountyId: bounty.id }),
				}),
			]);
			toast.success(`${label} confirmed on Solana Devnet.`);
		} catch (cause) {
			const message = getReadableError(cause, `${label} failed.`);
			setActionError(message);
			toast.error(message);
		} finally {
			setBusy(null);
		}
	}

	async function runAction(action: () => Promise<void>) {
		try {
			await action();
		} catch (cause) {
			const message = getReadableError(cause, "Solana action failed.");
			setActionError(message);
			toast.error(message);
		}
	}

	async function claimBounty() {
		if (!claim || !network.data?.programId || !bounty.onchainBountyId)
			throw new Error(
				"A verified, current claim attestation is not available yet.",
			);
		if (!connected?.account.address || !claimIsForConnectedWallet)
			throw new Error(
				"The connected and PasinPay-linked wallet must match the verified GitHub contributor’s payout wallet.",
			);
		const { rpc } = createDevnetRpc();
		const config = await fetchSolanaEscrowConfig(rpc, network.data.programId);
		if (
			!config ||
			config.mint !== SOLANA_DEVNET_USDC_MINT ||
			config.feeTreasury !== network.data.feeTreasury ||
			config.feeBps !== network.data.feeBps ||
			config.networkDomain.some(
				(byte, index) => byte !== SOLANA_DEVNET_NETWORK_DOMAIN[index],
			)
		)
			throw new Error(
				"Solana server and on-chain escrow configuration do not match; claiming is disabled.",
			);
		const bountyAddress = await deriveBountyAddress(
			network.data.programId,
			BigInt(bounty.onchainBountyId),
		);
		const nonce = new Uint8Array(32);
		nonce.set(bigintToLittleEndian(BigInt(claim.attestationNonce), 8));
		const expiresAt = BigInt(
			Math.floor(new Date(claim.attestationExpiresAt).getTime() / 1000),
		);
		if (expiresAt <= BigInt(Math.floor(Date.now() / 1000)))
			throw new Error(
				"This claim attestation has expired. Wait for PasinPay to refresh it from GitHub evidence.",
			);
		const commitHash = hexToBytes(
			`0x${claim.mergeCommitSha.toLowerCase().padStart(64, "0")}`,
			32,
		);
		const message = encodeSolanaClaimMessage({
			programId: network.data.programId,
			networkDomain: config.networkDomain,
			bountyAddress,
			bountyId: BigInt(bounty.onchainBountyId),
			repositoryHash: hexToBytes(bounty.repositoryHash, 32),
			issueNumber: bounty.issueNumber,
			prNumber: claim.githubPrNumber,
			commitHash,
			claimant: claim.claimantWallet,
			expiresAt,
			nonce,
		});
		const attestationDigest = bytesToHex(
			new Uint8Array(await crypto.subtle.digest("SHA-256", message)),
		);
		if (
			attestationDigest.toLowerCase() !== claim.attestationDigest.toLowerCase()
		)
			throw new Error(
				"Claim attestation does not bind to the stored bounty, PR, commit, network, claimant, and expiry.",
			);
		const signature = new Uint8Array(
			getBase58Encoder().encode(claim.attestationSignature),
		);
		assertIsSignatureBytes(signature);
		const attestorPublicKey = await getPublicKeyFromAddress(
			address(config.attestor),
		);
		if (!(await verifySignature(attestorPublicKey, signature, message)))
			throw new Error("Claim attestation signature is invalid.");
		const ed25519 = createEd25519VerificationInstruction({
			attestor: config.attestor,
			signature,
			message,
		});
		const instruction = await createClaimInstruction({
			programId: network.data.programId,
			claimant: claim.claimantWallet,
			bountyId: BigInt(bounty.onchainBountyId),
			prNumber: claim.githubPrNumber,
			commitHash,
			expiresAt,
			nonce,
		});
		await submitInstructions(
			"Claim submission",
			[ed25519, instruction],
			"ClaimPending",
		);
	}

	async function creatorAction(
		action: "approveClaim" | "disputeClaim" | "cancelBounty",
	) {
		const creatorAddress = connected?.account.address;
		if (!creatorMayAct || !creatorAddress || !bounty.onchainBountyId)
			throw new Error(
				"Connect the creator wallet and link it to your PasinPay account first.",
			);
		const instruction = await createCreatorActionInstruction({
			programId: bounty.chain.escrowAddress,
			creator: creatorAddress,
			bountyId: BigInt(bounty.onchainBountyId),
			action,
		});
		await submitInstructions(
			action,
			[instruction],
			action === "cancelBounty"
				? "Cancelled"
				: action === "disputeClaim"
					? "Disputed"
					: "ClaimPending",
		);
	}

	async function finalizeClaim() {
		if (
			!onchain ||
			!bounty.onchainBountyId ||
			!network.data?.programId ||
			!connected?.signer ||
			!connected.account.address
		)
			throw new Error(
				"Connect a signing-capable wallet to pay the finalization fee and submit this transaction.",
			);
		if (
			!onchain.approved ||
			BigInt(Math.floor(Date.now() / 1000)) < onchain.reviewEnds
		)
			throw new Error(
				"The creator must approve the claim and the review window must end before finalization.",
			);
		const config = await fetchSolanaEscrowConfig(
			createDevnetRpc().rpc,
			network.data.programId,
		);
		if (!config)
			throw new Error("Solana escrow configuration account is missing.");
		const instruction = await createFinalizeClaimInstruction({
			programId: network.data.programId,
			bountyId: onchain.id,
			claimant: onchain.claimant,
			feeTreasury: config.feeTreasury,
			mint: config.mint,
		});
		const claimantToken = await deriveAssociatedTokenAddress(
			onchain.claimant,
			config.mint,
		);
		const feeToken = await deriveAssociatedTokenAddress(
			config.feeTreasury,
			config.mint,
		);
		await submitInstructions(
			"Finalize claim and pay reward + fee",
			[
				createAssociatedTokenAccountIdempotentInstruction({
					payer: connected.account.address,
					owner: onchain.claimant,
					mint: config.mint,
					tokenAccount: claimantToken,
				}),
				createAssociatedTokenAccountIdempotentInstruction({
					payer: connected.account.address,
					owner: config.feeTreasury,
					mint: config.mint,
					tokenAccount: feeToken,
				}),
				instruction,
			],
			"Paid",
		);
	}

	async function refundExpired() {
		if (
			!onchain ||
			!network.data?.programId ||
			!bounty.onchainBountyId ||
			!connected?.account.address
		)
			throw new Error("Connect a wallet to pay the refund transaction fee.");
		const instruction = await createRefundExpiredInstruction({
			programId: network.data.programId,
			payer: connected.account.address,
			bountyId: onchain.id,
			creator: onchain.creator,
			mint: network.data.tokenAddress,
		});
		const creatorToken = await deriveAssociatedTokenAddress(
			onchain.creator,
			network.data.tokenAddress,
		);
		await submitInstructions(
			"Refund expired bounty",
			[
				createAssociatedTokenAccountIdempotentInstruction({
					payer: connected.account.address,
					owner: onchain.creator,
					mint: network.data.tokenAddress,
					tokenAccount: creatorToken,
				}),
				instruction,
			],
			"Refunded",
		);
	}

	async function resolveDispute() {
		if (!onchain || !network.data?.programId || !connected?.account.address)
			throw new Error(
				"Connect the Solana escrow authority wallet to resolve this dispute.",
			);
		const config = await fetchSolanaEscrowConfig(
			createDevnetRpc().rpc,
			network.data.programId,
		);
		if (!config || connected.account.address !== config.authority)
			throw new Error(
				"Only the configured escrow authority can resolve a dispute.",
			);
		const instruction = await createResolveDisputeInstruction({
			programId: network.data.programId,
			authority: connected.account.address,
			bountyId: onchain.id,
			creator: onchain.creator,
			claimant: onchain.claimant,
			feeTreasury: config.feeTreasury,
			claimantBps: normalizedClaimBps,
			mint: config.mint,
		});
		const [creatorToken, claimantToken, feeToken] = await Promise.all([
			deriveAssociatedTokenAddress(onchain.creator, config.mint),
			deriveAssociatedTokenAddress(onchain.claimant, config.mint),
			deriveAssociatedTokenAddress(config.feeTreasury, config.mint),
		]);
		await submitInstructions(
			"Resolve claim dispute",
			[
				createAssociatedTokenAccountIdempotentInstruction({
					payer: connected.account.address,
					owner: onchain.creator,
					mint: config.mint,
					tokenAccount: creatorToken,
				}),
				createAssociatedTokenAccountIdempotentInstruction({
					payer: connected.account.address,
					owner: onchain.claimant,
					mint: config.mint,
					tokenAccount: claimantToken,
				}),
				createAssociatedTokenAccountIdempotentInstruction({
					payer: connected.account.address,
					owner: config.feeTreasury,
					mint: config.mint,
					tokenAccount: feeToken,
				}),
				instruction,
			],
			normalizedClaimBps > 0 ? "Paid" : "Refunded",
		);
	}

	const reviewRemaining = useMemo(
		() =>
			onchain
				? Math.max(
						0,
						Number(onchain.reviewEnds) - Math.floor(Date.now() / 1000),
					)
				: 0,
		[onchain],
	);
	const claimDisplay = claimRecord ? `PR #${claimRecord.githubPrNumber}` : null;
	const deadlinePassed = Date.now() > new Date(bounty.deadline).getTime();

	return (
		<main className="mx-auto grid w-full max-w-6xl gap-8 px-5 py-12 lg:grid-cols-[minmax(0,1fr)_360px]">
			<div className="space-y-6">
				<div className="space-y-3">
					<div className="flex flex-wrap items-center gap-3">
						<p className="text-muted-foreground text-sm">
							{bounty.repository} · Issue #{bounty.issueNumber}
						</p>
						<Badge variant={statusTone(status)}>{status}</Badge>
						<NetworkBadge chainId={SOLANA_DEVNET_ID} />
					</div>
					<h1 className="font-semibold text-3xl tracking-tight sm:text-4xl">
						{bounty.title}
					</h1>
					<div className="flex flex-wrap gap-2">
						<Button
							variant="outline"
							size="sm"
							render={
								<a href={bounty.issueUrl} target="_blank" rel="noreferrer">
									GitHub issue <ExternalLink data-icon="inline-end" />
								</a>
							}
						/>
						<Link
							href={`https://github.com/${bounty.repository}`}
							target="_blank"
							className="inline-flex h-8 items-center gap-2 border px-3 text-sm"
						>
							{bounty.repository}
							<ExternalLink className="size-3" />
						</Link>
					</div>
				</div>
				<Card>
					<CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
						<div className="flex min-w-0 items-center gap-3">
							<Avatar>
								<AvatarImage src={bounty.creator.image ?? undefined} />
								<AvatarFallback>
									{bounty.creator.name.slice(0, 2).toUpperCase()}
								</AvatarFallback>
							</Avatar>
							<div>
								<p className="font-medium">{bounty.creator.name}</p>
								<p className="text-muted-foreground text-sm">Creator</p>
							</div>
						</div>
						<div className="text-right">
							<p className="text-muted-foreground text-xs">CREATOR WALLET</p>
							<a
								className="font-mono text-sm underline underline-offset-4"
								href={solanaExplorerAddressUrl(bounty.creatorWallet)}
								target="_blank"
								rel="noreferrer"
							>
								{bounty.creatorWallet.slice(0, 8)}…
								{bounty.creatorWallet.slice(-6)}{" "}
								<ExternalLink className="inline size-3" />
							</a>
						</div>
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>On-chain bounty state</CardTitle>
						<CardDescription>
							Read from the Solana Devnet program account and refreshed
							automatically.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-5 sm:grid-cols-2">
						<div>
							<p className="text-muted-foreground text-xs">REWARD</p>
							<p className="mt-1 font-medium">
								{usdc(onchain?.amount ?? bounty.amount)}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">PLATFORM FEE</p>
							<p className="mt-1 font-medium">
								{usdc(onchain?.feeAmount ?? bounty.feeAmount)}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">TOTAL FUNDED</p>
							<p className="mt-1 font-medium">
								{usdc(onchain?.totalFunded ?? bounty.totalFunded)}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">ESCROW ACCOUNT</p>
							<a
								className="mt-1 inline-flex items-center gap-1 font-mono text-sm underline"
								href={solanaExplorerAddressUrl(explorerAddress)}
								target="_blank"
								rel="noreferrer"
							>
								{explorerAddress.slice(0, 8)}…{explorerAddress.slice(-6)}{" "}
								<ExternalLink className="size-3" />
							</a>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">DEADLINE</p>
							<p className="mt-1 text-sm">
								{new Date(bounty.deadline).toLocaleString()}
							</p>
						</div>
						<div>
							<p className="text-muted-foreground text-xs">
								PULL REQUEST EVIDENCE
							</p>
							<p className="mt-1 text-sm">
								{claimDisplay ??
									`${bounty.pullRequests.length} submission${bounty.pullRequests.length === 1 ? "" : "s"}`}
							</p>
						</div>
						{onchain?.status === "ClaimPending" && (
							<div className="sm:col-span-2">
								<p className="flex items-center gap-2 text-sm">
									<Clock3 className="size-4" />
									{onchain.approved
										? reviewRemaining > 0
											? `Approved; payment becomes permissionlessly final in ${reviewRemaining}s.`
											: "Approved; the review period has ended and anyone may finalize the payout."
										: "Claim awaits creator approval before the review period starts."}
								</p>
							</div>
						)}
					</CardContent>
				</Card>
				<Card>
					<CardHeader>
						<CardTitle>Submissions</CardTitle>
						<CardDescription>
							Only a merged PR with the PasinPay issue marker can receive an
							attestation.
						</CardDescription>
					</CardHeader>
					<CardContent className="divide-y p-0">
						{bounty.pullRequests.length ? (
							bounty.pullRequests.map((pr) => (
								<div
									key={pr.number}
									className="flex flex-wrap items-center justify-between gap-3 p-4"
								>
									<div className="min-w-0">
										<a
											className="font-medium underline underline-offset-4"
											href={pr.htmlUrl}
											target="_blank"
											rel="noreferrer"
										>
											PR #{pr.number} · {pr.title}{" "}
											<ExternalLink className="inline size-3" />
										</a>
										<p className="mt-1 text-muted-foreground text-sm">
											{pr.authorLogin ? `@${pr.authorLogin} · ` : ""}
											{pr.status}
											{claimRecord?.githubPrNumber === pr.number
												? " · canonical claim"
												: ""}
										</p>
									</div>
									<Badge
										variant={
											pr.status === "Verified"
												? "default"
												: pr.status === "Superseded"
													? "destructive"
													: "outline"
										}
									>
										{pr.status}
									</Badge>
								</div>
							))
						) : (
							<p className="p-4 text-muted-foreground text-sm">
								No matching pull requests have been submitted yet.
							</p>
						)}
					</CardContent>
				</Card>
				{status === "Paid" && bounty.settlement && (
					<Alert>
						<CheckCircle2 className="size-4" />
						<AlertTitle>Reward settled</AlertTitle>
						<AlertDescription>
							Paid {usdc(bounty.settlement.amount)} to{" "}
							<a
								className="font-mono underline"
								href={solanaExplorerAddressUrl(bounty.settlement.recipient)}
								target="_blank"
								rel="noreferrer"
							>
								{bounty.settlement.recipient.slice(0, 8)}…
								{bounty.settlement.recipient.slice(-6)}
							</a>
							. Platform fee: {usdc(bounty.settlement.feeAmount)}.{" "}
							<a
								className="underline"
								href={solanaExplorerTransactionUrl(
									bounty.settlement.transactionHash,
								)}
								target="_blank"
								rel="noreferrer"
							>
								View transaction
							</a>
						</AlertDescription>
					</Alert>
				)}
				{actionError && (
					<Alert variant="destructive">
						<AlertTitle>Action needs attention</AlertTitle>
						<AlertDescription>{actionError}</AlertDescription>
					</Alert>
				)}
				{lastSignature && (
					<p className="text-sm">
						Last confirmed action:{" "}
						<a
							className="font-mono underline"
							href={solanaExplorerTransactionUrl(lastSignature)}
							target="_blank"
							rel="noreferrer"
						>
							{lastSignature.slice(0, 12)}…{" "}
							<ExternalLink className="inline size-3" />
						</a>
					</p>
				)}
			</div>
			<aside className="h-fit space-y-5 lg:sticky lg:top-8">
				<Card>
					<CardHeader className="border-b">
						<p className="text-muted-foreground text-xs">BOUNTY REWARD</p>
						<div className="font-semibold text-4xl tracking-tight">
							{usdc(bounty.amount)}
						</div>
						<CardDescription>
							Deadline {new Date(bounty.deadline).toLocaleDateString()}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3 pt-4">
						{networkId !== SOLANA_DEVNET_ID && (
							<Button
								className="w-full"
								onClick={() => void selectNetwork(SOLANA_DEVNET_ID)}
							>
								Switch to Solana Devnet
							</Button>
						)}
						{status === "Funded" && claim ? (
							<Button
								className="w-full"
								disabled={
									Boolean(busy) ||
									!claimIsForConnectedWallet ||
									bountyAddressQuery.isLoading
								}
								onClick={() =>
									void claimBounty().catch((error) => {
										const message = getReadableError(
											error,
											"Claim validation failed.",
										);
										setActionError(message);
										toast.error(message);
									})
								}
							>
								{busy === "Claim submission" ? (
									<>
										<LoaderCircle className="animate-spin" />
										Confirming claim…
									</>
								) : (
									`Claim ${bounty.chain.tokenSymbol}`
								)}
								<ArrowUpRight data-icon="inline-end" />
							</Button>
						) : status === "Funded" ? (
							<p className="text-muted-foreground text-sm">
								Waiting for GitHub verification of a merged pull request.
							</p>
						) : status === "ClaimPending" ? (
							<p className="text-muted-foreground text-sm">
								Claim submitted.{" "}
								{onchain?.approved
									? "Creator approval is recorded; the review timer is running."
									: "The creator must review and approve this claim."}
							</p>
						) : status === "Paid" ? (
							<p className="flex items-center gap-2 text-sm">
								<CheckCircle2 className="size-4" />
								This bounty has been paid.
							</p>
						) : status === "Refunded" ? (
							<p className="text-muted-foreground text-sm">
								This escrow has been refunded.
							</p>
						) : status === "Cancelled" ? (
							<p className="text-muted-foreground text-sm">
								This bounty was cancelled before funding.
							</p>
						) : null}
						<p className="flex items-center gap-2 text-muted-foreground text-sm">
							<Clock3 className="size-4" />
							Creator approval and review required
						</p>
						<div className="flex items-start gap-2 border-t pt-3 text-muted-foreground text-sm">
							<ShieldCheck className="mt-0.5 size-4 shrink-0" />
							Reward and fee stay in the PDA vault until the escrow program
							permits settlement.
						</div>
					</CardContent>
				</Card>
				{status === "Open" && addressMatchesBounty && creatorMayAct && (
					<Card>
						<CardHeader>
							<CardTitle>Fund bounty</CardTitle>
							<CardDescription>
								Lock the quoted reward plus platform fee into the
								program-controlled USDC vault.
							</CardDescription>
						</CardHeader>
						<CardContent>
							<FundSolanaBounty
								bounty={bounty}
								onchain={onchain ?? undefined}
								busy={busy}
								setBusy={setBusy}
								onDone={async (signature) => {
									setLastSignature(signature);
									await readVerifiedState();
								}}
							/>
						</CardContent>
					</Card>
				)}
				{creatorMayAct && (
					<Card>
						<CardHeader>
							<CardTitle>Creator controls</CardTitle>
							<CardDescription>
								Each action opens your wallet. The on-chain program checks the
								creator signature, escrow state, deadline, and review timer.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-3">
							{status === "Open" && (
								<ControlButton
									label="Cancel bounty"
									explanation="Closes this unfunded bounty. It cannot be funded or claimed after cancellation."
									busy={busy}
									onClick={() =>
										void runAction(() => creatorAction("cancelBounty"))
									}
								/>
							)}
							{status === "ClaimPending" && !onchain?.approved && (
								<ControlButton
									label="Approve claim"
									explanation="Records creator approval and starts the review window. After it ends, anyone can finalize the reward and platform-fee transfer."
									busy={busy}
									onClick={() =>
										void runAction(() => creatorAction("approveClaim"))
									}
								/>
							)}
							{status === "ClaimPending" && (
								<ControlButton
									label="Dispute claim"
									explanation="Moves the claim into Disputed state before payout. The configured escrow authority—not the contributor—must then resolve the dispute."
									busy={busy}
									onClick={() =>
										void runAction(() => creatorAction("disputeClaim"))
									}
								/>
							)}
							{status === "ClaimPending" &&
								onchain?.approved &&
								reviewRemaining === 0 && (
									<ControlButton
										label="Finalize payout"
										explanation="Permissionlessly transfers the exact reward to the attested contributor and the configured platform fee to treasury."
										busy={busy}
										onClick={() => void runAction(finalizeClaim)}
									/>
								)}
							{(status === "Funded" || status === "ClaimPending") &&
								deadlinePassed &&
								!onchain?.approved && (
									<ControlButton
										label="Refund expired bounty"
										explanation="After the deadline, returns the complete funded amount to the creator. A claim already approved for payment cannot be refunded this way."
										busy={busy}
										onClick={() => void runAction(refundExpired)}
									/>
								)}
							{status === "Disputed" &&
								connected?.account.address ===
									onchainConfigQuery.data?.authority && (
									<div className="space-y-3">
										<label className="block text-sm" htmlFor="claimant-bps">
											Contributor share (basis points)
										</label>
										<input
											id="claimant-bps"
											className="h-9 w-full rounded-md border bg-background px-3 text-sm"
											value={claimantBps}
											onChange={(event) => setClaimantBps(event.target.value)}
											inputMode="numeric"
										/>
										<p className="text-muted-foreground text-xs">
											0–10,000 bps of the reward. The fee is paid only when a
											contributor share is awarded; 0 bps refunds the full
											escrow to the creator.
										</p>
										<Button
											className="w-full"
											disabled={!canResolveDispute || Boolean(busy)}
											onClick={() => void runAction(resolveDispute)}
										>
											Resolve dispute
										</Button>
									</div>
								)}
							{status === "Funded" && deadlinePassed && (
								<p className="text-muted-foreground text-xs">
									Refund is available after the on-chain deadline.
								</p>
							)}
							{!onchain && (
								<p className="text-muted-foreground text-xs">
									Waiting for confirmed Solana account data…
								</p>
							)}
						</CardContent>
					</Card>
				)}
				{!hasLinkedActiveWallet && (
					<p className="text-muted-foreground text-sm">
						Link the connected Solana wallet in{" "}
						<Link className="underline" href="/settings">
							Settings
						</Link>{" "}
						before claiming or using creator controls.
					</p>
				)}
			</aside>
		</main>
	);
}

function ControlButton({
	label,
	explanation,
	busy,
	onClick,
}: {
	label: string;
	explanation: string;
	busy: string | null;
	onClick: () => void;
}) {
	return (
		<div className="space-y-2 rounded-md border p-3">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className="font-medium text-sm">{label}</p>
				<Button
					size="sm"
					variant="outline"
					disabled={Boolean(busy)}
					onClick={onClick}
				>
					{busy === label ? "Waiting…" : label}
				</Button>
			</div>
			<p className="text-muted-foreground text-xs leading-relaxed">
				{explanation}
			</p>
		</div>
	);
}

function FundSolanaBounty({
	bounty,
	onchain,
	busy,
	setBusy,
	onDone,
}: {
	bounty: SolanaBountyRecord;
	onchain: SolanaBountyState | undefined;
	busy: string | null;
	setBusy: (value: string | null) => void;
	onDone: (signature: string) => Promise<void>;
}) {
	const connected = useConnectedWallet(solanaClient);
	const [error, setError] = useState<string | null>(null);
	async function fund() {
		if (!connected?.signer || !connected.account.address || !onchain)
			return setError("Connect the creator wallet to fund this bounty.");
		setBusy("Funding bounty");
		setError(null);
		try {
			const network = await queryClientlessSolanaConfig(
				bounty.chain.escrowAddress,
			);
			if (!network || network.mint !== SOLANA_DEVNET_USDC_MINT)
				throw new Error(
					"The escrow program is not configured for official Devnet USDC.",
				);
			const fund = await createFundBountyInstruction({
				programId: bounty.chain.escrowAddress,
				creator: connected.account.address,
				bountyId: onchain.id,
				rewardAmount: BigInt(bounty.amount),
				mint: network.mint,
			});
			const createAta = createAssociatedTokenAccountIdempotentInstruction({
				payer: connected.account.address,
				owner: connected.account.address,
				mint: network.mint,
				tokenAccount: fund.creatorTokenAddress,
			});
			const signature = await sendSolanaInstructions({
				feePayer: connected.signer,
				instructions: [createAta, fund.instruction],
			});
			const { rpc } = createDevnetRpc();
			const bountyAddress = await deriveBountyAddress(
				bounty.chain.escrowAddress,
				onchain.id,
			);
			const { value } = await rpc
				.getAccountInfo(address(bountyAddress), {
					commitment: "confirmed",
					encoding: "base64",
				})
				.send();
			if (!value)
				throw new Error(
					"Funding confirmed, but the bounty account is unavailable for verification.",
				);
			const funded = decodeSolanaBountyAccount(decodeAccount(value.data[0]));
			if (
				funded.status !== "Funded" ||
				funded.totalFunded !== BigInt(bounty.totalFunded)
			)
				throw new Error(
					"Funding transaction confirmed, but on-chain status and funding total do not match the indexed bounty.",
				);
			await onDone(signature);
			toast.success("Bounty funding confirmed on Solana Devnet.");
		} catch (cause) {
			const message = getReadableError(cause, "Solana bounty funding failed.");
			setError(message);
			toast.error(message);
		} finally {
			setBusy(null);
		}
	}
	return (
		<div className="space-y-3">
			<p className="text-muted-foreground text-sm">
				The program will pull {usdc(bounty.totalFunded)} from the connected
				wallet. The contributor amount is {usdc(bounty.amount)}; the fee is{" "}
				{usdc(bounty.feeAmount)}.
			</p>
			{error && (
				<p role="alert" className="text-destructive text-sm">
					{error}
				</p>
			)}
			<Button
				className="w-full"
				disabled={
					Boolean(busy) ||
					!onchain ||
					!connected?.signer ||
					connected.account.address !== bounty.creatorWallet
				}
				onClick={() => void fund()}
			>
				{busy === "Funding bounty" ? (
					<>
						<LoaderCircle className="animate-spin" />
						Confirming funding…
					</>
				) : (
					"Fund bounty"
				)}
			</Button>
		</div>
	);
}

async function queryClientlessSolanaConfig(programId: string) {
	const { rpc } = createDevnetRpc();
	return fetchSolanaEscrowConfig(rpc, programId);
}
