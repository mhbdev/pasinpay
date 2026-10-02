"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, BriefcaseBusiness, Plus } from "lucide-react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth-guard";
import { UsdAmount } from "@/components/usd-amount";
import { trpc } from "@/utils/trpc";

export default function DashboardPage() {
	const { data, isLoading } = useQuery(trpc.bounties.mine.queryOptions());
	return (
		<AuthGuard>
			<main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12">
				<div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
					<div>
						<p className="text-muted-foreground text-sm">YOUR WORKSPACE</p>
						<h1 className="mt-2 font-semibold text-4xl tracking-tight">
							Dashboard
						</h1>
						<p className="mt-2 text-muted-foreground">
							Track bounties you created and work you shipped.
						</p>
					</div>
					<Button render={<Link href="/create" />}>
						<Plus data-icon="inline-start" /> Create bounty
					</Button>
				</div>
				<div className="grid gap-4 sm:grid-cols-3">
					<Card>
						<CardContent className="flex flex-col gap-2 pt-6">
							<p className="text-muted-foreground text-sm">Created</p>
							<p className="font-semibold text-3xl">{data?.length ?? 0}</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-2 pt-6">
							<p className="text-muted-foreground text-sm">Payment ready</p>
							<p className="font-semibold text-3xl">
								{data?.filter((item) => item.status === "ClaimPending")
									.length ?? 0}
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardContent className="flex flex-col gap-2 pt-6">
							<p className="text-muted-foreground text-sm">Settled</p>
							<p className="font-semibold text-3xl">
								{data?.filter((item) => item.status === "Paid").length ?? 0}
							</p>
						</CardContent>
					</Card>
				</div>
				<Card>
					<CardHeader className="border-b">
						<CardTitle className="flex items-center gap-2 text-base">
							<BriefcaseBusiness className="size-4" /> Bounties
						</CardTitle>
					</CardHeader>
					<CardContent className="p-0">
						{isLoading ? (
							<p className="p-6 text-muted-foreground text-sm">
								Loading dashboard…
							</p>
						) : !data?.length ? (
							<div className="p-12 text-center">
								<p className="font-medium">Nothing here yet</p>
								<p className="mt-2 text-muted-foreground text-sm">
									Fund a GitHub task to start your workspace.
								</p>
							</div>
						) : (
							<div className="divide-y">
								{data.map((item) => (
									<Link
										className="flex items-center justify-between gap-4 p-5 hover:bg-muted/40"
										href={`/bounties/${item.id}`}
										key={item.id}
									>
										<div>
											<p className="font-medium">{item.title}</p>
											<p className="mt-1 text-muted-foreground text-sm">
												{item.repository} · Issue #{item.issueNumber}
											</p>
										</div>
										<div className="flex items-center gap-4">
											<div className="text-right">
												<UsdAmount amount={item.amount} />
												<p className="mt-1 text-muted-foreground text-xs">
													{item.status}
												</p>
											</div>
											<ArrowUpRight className="size-4 text-muted-foreground" />
										</div>
									</Link>
								))}
							</div>
						)}
					</CardContent>
				</Card>
			</main>
		</AuthGuard>
	);
}
