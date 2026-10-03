"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import {
	ArrowRight,
	Check,
	GitPullRequest,
	ShieldCheck,
	WalletCards,
} from "lucide-react";
import Link from "next/link";

const steps = [
	["01", "Fund", "Create a GitHub task and lock USDG in escrow."],
	["02", "Build", "Ship the work in a pull request."],
	["03", "Merge", "The maintainer merges the approved change."],
	["04", "Get paid", "Verified evidence unlocks the settlement."],
] as const;

export default function Home() {
	return (
		<main className="overflow-hidden">
			<section className="mx-auto grid max-w-6xl gap-16 px-5 pt-20 pb-24 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:pt-28">
				<div className="flex flex-col gap-7">
					<div className="flex w-fit items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-muted-foreground text-xs">
						<span className="size-1.5 rounded-full bg-emerald-500" />{" "}
						GitHub-native settlement on Arbitrum
					</div>
					<h1 className="max-w-2xl font-semibold text-5xl tracking-[-0.05em] sm:text-7xl">
						Pay for shipped code, automatically.
					</h1>
					<p className="max-w-xl text-lg text-muted-foreground leading-8">
						Fund GitHub work in USDG. When the approved pull request merges,
						PasinPay turns the work into a verifiable payment on Arbitrum.
					</p>
					<div className="flex flex-wrap gap-3">
						<Button render={<Link href="/create" />} size="lg">
							Create bounty <ArrowRight data-icon="inline-end" />
						</Button>
						<Button
							render={<Link href="/bounties" />}
							size="lg"
							variant="outline"
						>
							Explore bounties
						</Button>
					</div>
					<div className="flex items-center gap-6 border-t pt-6 text-muted-foreground text-sm">
						<span className="flex items-center gap-2">
							<ShieldCheck className="size-4" /> EIP-712 evidence
						</span>
						<span className="flex items-center gap-2">
							<WalletCards className="size-4" /> USDG escrow
						</span>
					</div>
				</div>
				<Card className="relative">
					<div className="absolute inset-x-0 top-0 h-1 bg-foreground" />
					<CardHeader className="gap-5 border-b">
						<div className="flex items-center justify-between text-muted-foreground text-xs">
							<span>LIVE BOUNTY</span>
							<span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
								FUNDED
							</span>
						</div>
						<div>
							<CardTitle className="text-2xl tracking-tight">
								Fix checkout timeout
							</CardTitle>
							<p className="mt-1 text-muted-foreground text-sm">
								acme/storefront · Issue #17
							</p>
						</div>
						<div className="font-semibold text-4xl tracking-tight">
							$500{" "}
							<span className="font-medium text-base text-muted-foreground">
								USDG
							</span>
						</div>
					</CardHeader>
					<CardContent className="flex flex-col gap-4">
						{[
							"Bounty created",
							"USDG funded",
							"PR opened",
							"PR merged",
							"Evidence verified",
						].map((label, index) => (
							<div className="flex items-center gap-3 text-sm" key={label}>
								<span className="flex size-6 items-center justify-center rounded-full bg-foreground text-background">
									<Check className="size-3.5" />
								</span>
								<span
									className={
										index === 4 ? "font-medium" : "text-muted-foreground"
									}
								>
									{label}
								</span>
							</div>
						))}
						<div className="mt-2 rounded-lg bg-muted/60 p-4">
							<div className="flex items-center gap-2 font-medium text-sm">
								<GitPullRequest className="size-4" /> Payment ready
							</div>
							<p className="mt-1 text-muted-foreground text-xs">
								PR #412 · merge commit 8b72c4…
							</p>
						</div>
					</CardContent>
				</Card>
			</section>
			<section className="border-y bg-muted/20">
				<div className="mx-auto grid max-w-6xl gap-px px-5 py-12 sm:grid-cols-4">
					{steps.map(([number, title, text]) => (
						<div
							className="flex flex-col gap-3 border-l px-5 first:border-l-0"
							key={number}
						>
							<span className="font-mono text-muted-foreground text-xs">
								{number}
							</span>
							<h2 className="font-medium">{title}</h2>
							<p className="text-muted-foreground text-sm leading-6">{text}</p>
						</div>
					))}
				</div>
			</section>
			<section className="mx-auto flex max-w-6xl flex-col gap-8 px-5 py-20">
				<div className="max-w-xl">
					<p className="font-medium text-muted-foreground text-sm">
						THE WORKFLOW
					</p>
					<h2 className="mt-3 font-semibold text-3xl tracking-tight">
						GitHub proves the work. PasinPay enforces the payment.
					</h2>
				</div>
				<div className="grid gap-4 md:grid-cols-3">
					<Card>
						<CardContent className="flex flex-col gap-3">
							<GitPullRequest className="size-5" />
							<h3 className="font-medium">Evidence, not promises</h3>
							<p className="text-muted-foreground text-sm leading-6">
								A merged pull request, repository, issue, and commit become
								signed claim data.
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<WalletCards className="size-5" />
							<h3 className="font-medium">Non-custodial escrow</h3>
							<p className="text-muted-foreground text-sm leading-6">
								USDG stays in the contract until the creator approves the
								verified work.
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-3">
							<ShieldCheck className="size-5" />
							<h3 className="font-medium">A public receipt</h3>
							<p className="text-muted-foreground text-sm leading-6">
								Every settlement links the shipped code to a real Arbitrum
								transaction.
							</p>
						</CardContent>
					</Card>
				</div>
			</section>
		</main>
	);
}
