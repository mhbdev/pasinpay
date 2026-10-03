"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, CircleDollarSign, Search } from "lucide-react";
import Link from "next/link";
import { UsdAmount } from "@/components/usd-amount";
import { trpc } from "@/utils/trpc";

export default function BountiesPage() {
	const { data, isLoading } = useQuery(trpc.bounties.list.queryOptions());
	return (
		<main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12">
			<div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
				<div>
					<p className="text-muted-foreground text-sm">OPEN WORK</p>
					<h1 className="mt-2 font-semibold text-4xl tracking-tight">
						Funded bounties
					</h1>
					<p className="mt-2 text-muted-foreground">
						Find GitHub work with a clear payment condition.
					</p>
				</div>
				<Button render={<Link href="/create" />}>Create bounty</Button>
			</div>
			<Card>
				<CardHeader className="border-b">
					<CardTitle className="flex items-center gap-2 text-base">
						<Search className="size-4" /> Available work
					</CardTitle>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<div className="p-6 text-muted-foreground text-sm">
							Loading bounties…
						</div>
					) : !data?.length ? (
						<div className="flex flex-col items-center gap-3 p-12 text-center">
							<CircleDollarSign className="size-8 text-muted-foreground" />
							<p className="font-medium">No funded bounties yet</p>
							<p className="text-muted-foreground text-sm">
								Create the first task and make the payment condition explicit.
							</p>
						</div>
					) : (
						<div className="divide-y">
							{data.map((item) => (
								<Link
									className="flex items-center justify-between gap-5 py-4 transition-colors hover:bg-muted/40"
									href={`/bounties/${item.id}`}
									key={item.id}
								>
									<div className="min-w-0">
										<p className="truncate font-medium">{item.title}</p>
										<p className="mt-1 truncate text-muted-foreground text-sm">
											{item.repository} · Issue #{item.issueNumber}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-5">
										<div className="text-right">
											<UsdAmount amount={item.amount} className="font-medium" />
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
	);
}
