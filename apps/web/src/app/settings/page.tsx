"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardDescription,
	CardFooter,
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
} from "@pasinpay/ui/components/dialog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	Copy,
	ExternalLink,
	GitBranch,
	KeyRound,
	Link2,
	RefreshCw,
	ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { useAccount, useConnect, useSignMessage, useSwitchChain } from "wagmi";
import { AuthGuard } from "@/components/auth-guard";
import { useAppNetwork } from "@/components/network-provider";
import { authClient } from "@/lib/auth-client";
import { getReadableError } from "@/lib/errors";
import { trpc } from "@/utils/trpc";

export default function SettingsPage() {
	const { data: session, isPending: sessionPending } = authClient.useSession();
	const isAuthenticated = !sessionPending && Boolean(session);
	const { address, chainId } = useAccount();
	const { chainConfig } = useAppNetwork();
	const { connectAsync, connectors } = useConnect();
	const { signMessageAsync } = useSignMessage();
	const { switchChainAsync } = useSwitchChain();
	const queryClient = useQueryClient();
	const challenge = useMutation(
		trpc.bounties.walletChallenge.mutationOptions(),
	);
	const linkWallet = useMutation(trpc.bounties.linkWallet.mutationOptions());
	const wallet = useQuery(
		trpc.bounties.walletLink.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const unlinkWallet = useMutation(
		trpc.bounties.unlinkWallet.mutationOptions(),
	);
	const githubApp = useQuery(
		trpc.bounties.githubApp.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const githubStatus = useQuery(
		trpc.bounties.githubStatus.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const repositories = useQuery(
		trpc.bounties.repositories.queryOptions(undefined, {
			enabled: isAuthenticated,
		}),
	);
	const refreshRepositories = useMutation({
		...trpc.bounties.refreshRepositories.mutationOptions(),
		onSuccess: async (result) => {
			await repositories.refetch();
			setMessage(`Synced ${result.synced} installed repositories.`);
		},
		onError: (error) => setMessage(error.message),
	});
	const [message, setMessage] = useState<string | null>(null);
	const [unlinkOpen, setUnlinkOpen] = useState(false);
	const [apiKeyName, setApiKeyName] = useState("Coding agent");
	const [allowDrafts, setAllowDrafts] = useState(false);
	const [createdKey, setCreatedKey] = useState<{
		key: string;
		name: string;
		expiresAt: string | null;
	} | null>(null);
	const walletIsLinked = Boolean(wallet.data);
	const apiKeys = useQuery(
		trpc.apiKeys.list.queryOptions(undefined, { enabled: isAuthenticated }),
	);
	const createApiKey = useMutation(trpc.apiKeys.create.mutationOptions());
	const revokeApiKey = useMutation(trpc.apiKeys.revoke.mutationOptions());
	const mcpEndpoint = new URL(
		"/mcp",
		process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000",
	).toString();

	async function connectWallet() {
		try {
			let linkedAddress = address;
			let linkedChainId = chainId;
			if (!linkedAddress) {
				const connector = connectors[0];
				if (!connector) return setMessage("No browser wallet was detected.");
				const connection = await connectAsync({
					connector,
					chainId: chainConfig.id,
				});
				linkedAddress = connection.accounts[0];
				linkedChainId = connection.chainId;
			}
			if (!linkedAddress || !linkedChainId)
				return setMessage("Connect a wallet first.");
			if (linkedChainId !== chainConfig.id) {
				await switchChainAsync({ chainId: chainConfig.id });
				linkedChainId = chainConfig.id;
			}
			if (linkedChainId !== 421614 && linkedChainId !== 42161)
				return setMessage(
					"Switch to Arbitrum One or Arbitrum Sepolia before linking your wallet.",
				);
			const result = await challenge.mutateAsync({
				address: linkedAddress,
				chainId: linkedChainId,
			});
			const signature = await signMessageAsync({ message: result.message });
			await linkWallet.mutateAsync({
				nonce: result.nonce,
				address: linkedAddress,
				chainId: linkedChainId,
				signature,
			});
			await queryClient.invalidateQueries({
				queryKey: trpc.bounties.walletLink.queryKey(),
			});
			setMessage("Wallet linked successfully.");
		} catch (error) {
			setMessage(getReadableError(error, "Wallet linking failed."));
		}
	}

	async function unlinkLinkedWallet() {
		try {
			await unlinkWallet.mutateAsync();
			await queryClient.invalidateQueries({
				queryKey: trpc.bounties.walletLink.queryKey(),
			});
			setUnlinkOpen(false);
			setMessage("Wallet unlinked successfully.");
		} catch (error) {
			setMessage(getReadableError(error, "Wallet unlinking failed."));
		}
	}

	async function createAgentKey() {
		try {
			const result = await createApiKey.mutateAsync({
				name: apiKeyName,
				expiresInDays: 90,
				allowDrafts,
			});
			setCreatedKey(result);
			await apiKeys.refetch();
			setMessage("API key created. Copy it now; it will not be shown again.");
		} catch (error) {
			setMessage(getReadableError(error, "API key creation failed."));
		}
	}

	async function copyCreatedKey() {
		if (!createdKey) return;
		try {
			await navigator.clipboard.writeText(createdKey.key);
			setMessage("API key copied to the clipboard.");
		} catch (error) {
			setMessage(getReadableError(error, "Could not copy the API key."));
		}
	}

	async function revokeAgentKey(id: string) {
		try {
			await revokeApiKey.mutateAsync({ id });
			await apiKeys.refetch();
			setMessage("API key revoked.");
		} catch (error) {
			setMessage(getReadableError(error, "API key revocation failed."));
		}
	}

	return (
		<AuthGuard>
			<main className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-5 py-12">
				<div>
					<p className="text-muted-foreground text-sm">ACCOUNT</p>
					<h1 className="mt-2 font-semibold text-4xl tracking-tight">
						Settings
					</h1>
					<p className="mt-2 text-muted-foreground">
						Connect the identities PasinPay uses to verify work and route
						payment.
					</p>
				</div>
				<div className="grid gap-6">
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<GitBranch className="size-4" /> GitHub
							</CardTitle>
							<CardDescription>
								GitHub identifies the contributor and gives PasinPay access to
								installed repositories.
							</CardDescription>
						</CardHeader>
						<CardFooter className="justify-between gap-4">
							<div>
								<p className="font-medium">
									{githubStatus.data?.connected
										? session?.user?.name
										: "Not connected"}
								</p>
								<p className="text-muted-foreground text-sm">
									{githubStatus.data?.connected
										? (session?.user?.email ?? "GitHub connected")
										: "Connect GitHub to continue"}
								</p>
							</div>
							{githubStatus.data?.connected ? (
								<span className="flex items-center gap-2 text-emerald-600 text-sm">
									<ShieldCheck className="size-4" /> Connected
								</span>
							) : (
								<Button
									onClick={() =>
										authClient.signIn.social({
											provider: "github",
											callbackURL: `${window.location.origin}/settings`,
											errorCallbackURL: `${window.location.origin}/settings?authError=github`,
										})
									}
								>
									Connect GitHub
								</Button>
							)}
						</CardFooter>
						<CardFooter className="flex-col items-stretch gap-3">
							<div className="flex flex-wrap items-center gap-3">
								{githubApp.data?.installUrl && (
									<Button
										variant="outline"
										render={
											<a
												href={githubApp.data.installUrl}
												target="_blank"
												rel="noreferrer"
											/>
										}
									>
										Install GitHub App <ExternalLink data-icon="inline-end" />
									</Button>
								)}
								<Button
									variant="outline"
									onClick={() => refreshRepositories.mutate()}
									disabled={
										refreshRepositories.isPending ||
										!githubStatus.data?.connected
									}
								>
									<RefreshCw data-icon="inline-start" />
									{refreshRepositories.isPending
										? "Syncing repositories…"
										: "Sync installed repositories"}
								</Button>
							</div>
							{repositories.data && (
								<p className="text-muted-foreground text-sm">
									{repositories.data.length} installed{" "}
									{repositories.data.length === 1
										? "repository"
										: "repositories"}{" "}
									available for bounties.
								</p>
							)}
						</CardFooter>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<Link2 className="size-4" /> Wallet
							</CardTitle>
							<CardDescription>
								Sign a one-time message to associate your GitHub identity with a
								payout address.
							</CardDescription>
						</CardHeader>
						<CardFooter className="justify-between gap-4">
							<div>
								<p className="font-mono text-sm">
									{wallet.data?.walletAddress
										? `${wallet.data.walletAddress.slice(0, 8)}…${wallet.data.walletAddress.slice(-6)}`
										: address
											? `${address.slice(0, 8)}…${address.slice(-6)}`
											: "No wallet connected"}
								</p>
								<p className="mt-1 text-muted-foreground text-sm">
									{chainId === 42161
										? "Arbitrum One"
										: chainId === 421614
											? "Arbitrum Sepolia"
											: "Network not connected"}
								</p>
							</div>
							<Button
								onClick={() =>
									walletIsLinked ? setUnlinkOpen(true) : connectWallet()
								}
								disabled={
									!session?.user ||
									challenge.isPending ||
									linkWallet.isPending ||
									unlinkWallet.isPending
								}
							>
								{challenge.isPending ||
								linkWallet.isPending ||
								unlinkWallet.isPending
									? walletIsLinked
										? "Unlinking…"
										: "Linking…"
									: walletIsLinked
										? "Unlink wallet"
										: address
											? "Link wallet"
											: "Connect & link wallet"}
							</Button>
						</CardFooter>
						<Dialog open={unlinkOpen} onOpenChange={setUnlinkOpen}>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Unlink wallet?</DialogTitle>
									<DialogDescription>
										This removes the payout address from your PasinPay account.
										It does not disconnect your browser wallet or move any
										escrowed funds.
									</DialogDescription>
								</DialogHeader>
								<DialogFooter>
									<DialogClose render={<Button variant="outline" />}>
										Keep wallet linked
									</DialogClose>
									<Button
										variant="destructive"
										onClick={unlinkLinkedWallet}
										disabled={unlinkWallet.isPending}
									>
										{unlinkWallet.isPending ? "Unlinking…" : "Unlink wallet"}
									</Button>
								</DialogFooter>
							</DialogContent>
						</Dialog>
					</Card>
					<Card>
						<CardHeader>
							<CardTitle className="flex items-center gap-2 text-base">
								<KeyRound className="size-4" /> Agent access
							</CardTitle>
							<CardDescription>
								Connect an MCP-compatible agent with OAuth consent or a scoped,
								revocable API key. Keys can read bounties and optionally prepare
								drafts; they never approve wallets or move funds.
							</CardDescription>
						</CardHeader>
						<CardFooter className="flex-col items-stretch gap-5">
							<div className="rounded-lg border bg-muted/30 p-4 text-sm">
								<p className="font-medium">MCP endpoint</p>
								<code className="mt-2 block break-all text-muted-foreground text-xs">
									{mcpEndpoint}
								</code>
								<p className="mt-3 text-muted-foreground text-xs leading-5">
									OAuth clients use the consent page automatically. API-key
									clients must send{" "}
									<code>Authorization: Bearer &lt;key&gt;</code>.
								</p>
							</div>
							<div className="grid gap-3 sm:grid-cols-[1fr_auto]">
								<input
									aria-label="API key name"
									className="h-9 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
									maxLength={80}
									onChange={(event) => setApiKeyName(event.target.value)}
									placeholder="API key name"
									value={apiKeyName}
								/>
								<Button
									disabled={createApiKey.isPending || !apiKeyName.trim()}
									onClick={() => void createAgentKey()}
								>
									{createApiKey.isPending ? "Creating…" : "Create API key"}
								</Button>
							</div>
							<label className="flex items-start gap-3 text-muted-foreground text-sm">
								<input
									checked={allowDrafts}
									className="mt-1"
									onChange={(event) => setAllowDrafts(event.target.checked)}
									type="checkbox"
								/>
								<span>
									Allow draft preparation
									<span className="block text-xs">
										Adds <code>bounties:write</code>; the agent still cannot
										create, fund, approve, or settle a bounty.
									</span>
								</span>
							</label>
							{createdKey && (
								<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
									<p className="font-medium text-sm">Copy this key now</p>
									<p className="mt-1 text-muted-foreground text-xs">
										For your security, PasinPay will not display it again.
									</p>
									<div className="mt-3 flex items-center gap-2">
										<code className="min-w-0 flex-1 break-all rounded border bg-background p-2 text-xs">
											{createdKey.key}
										</code>
										<Button
											aria-label="Copy API key"
											onClick={() => void copyCreatedKey()}
											size="icon"
											variant="outline"
										>
											<Copy />
										</Button>
									</div>
								</div>
							)}
							{apiKeys.data && apiKeys.data.length > 0 && (
								<div className="divide-y rounded-lg border">
									{apiKeys.data.map((key) => (
										<div
											className="flex flex-wrap items-center justify-between gap-3 p-3"
											key={key.id}
										>
											<div className="min-w-0">
												<p className="font-medium text-sm">{key.name}</p>
												<p className="font-mono text-muted-foreground text-xs">
													{key.keyPrefix}… · {key.scopes.join(", ")}
												</p>
												<p className="text-muted-foreground text-xs">
													{key.revokedAt ? "Revoked" : "Active"}
													{key.expiresAt
														? ` · expires ${new Date(key.expiresAt).toLocaleDateString()}`
														: ""}
												</p>
											</div>
											{!key.revokedAt && (
												<Button
													disabled={revokeApiKey.isPending}
													onClick={() => void revokeAgentKey(key.id)}
													size="sm"
													variant="outline"
												>
													Revoke
												</Button>
											)}
										</div>
									))}
								</div>
							)}
						</CardFooter>
					</Card>
				</div>
				{message && (
					<p aria-live="polite" className="text-muted-foreground text-sm">
						{message}
					</p>
				)}
			</main>
		</AuthGuard>
	);
}
