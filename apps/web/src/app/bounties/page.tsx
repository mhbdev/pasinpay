"use client";

import { Badge } from "@pasinpay/ui/components/badge";
import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { Field, FieldGroup, FieldLabel } from "@pasinpay/ui/components/field";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@pasinpay/ui/components/input-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@pasinpay/ui/components/select";
import { Separator } from "@pasinpay/ui/components/separator";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
	ArrowUpRight,
	ChevronLeft,
	ChevronRight,
	CircleDollarSign,
	ListFilter,
	Search,
	X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { UsdAmount } from "@/components/usd-amount";
import { trpc } from "@/utils/trpc";

const PAGE_SIZE = 12;
const STATUS_VALUES = [
	"all",
	"Open",
	"Funded",
	"ClaimPending",
	"Paid",
	"Disputed",
	"Refunded",
	"Cancelled",
] as const;
const SORT_VALUES = ["newest", "oldest", "reward_high", "reward_low"] as const;

type StatusFilter = (typeof STATUS_VALUES)[number];
type SortFilter = (typeof SORT_VALUES)[number];

function readStatus(value: string | null): StatusFilter {
	return STATUS_VALUES.includes(value as StatusFilter)
		? (value as StatusFilter)
		: "all";
}

function readSort(value: string | null): SortFilter {
	return SORT_VALUES.includes(value as SortFilter)
		? (value as SortFilter)
		: "newest";
}

function statusLabel(status: string) {
	return status === "all"
		? "All statuses"
		: status.replace("ClaimPending", "Claim pending");
}

const sortLabels: Record<SortFilter, string> = {
	newest: "Newest first",
	oldest: "Oldest first",
	reward_high: "Highest reward",
	reward_low: "Lowest reward",
};

function BountiesContent() {
	const router = useRouter();
	const searchParams = useSearchParams();
	const urlSearch = searchParams.get("q") ?? "";
	const status = readStatus(searchParams.get("status"));
	const repository = searchParams.get("repository") ?? "";
	const sort = readSort(searchParams.get("sort"));
	const requestedPage = Math.max(
		1,
		Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
	);
	const [searchInput, setSearchInput] = useState(urlSearch);

	const updateUrl = useCallback(
		(updates: Record<string, string | null>, resetPage = true) => {
			const next = new URLSearchParams(searchParams.toString());
			for (const [key, value] of Object.entries(updates)) {
				if (value) next.set(key, value);
				else next.delete(key);
			}
			if (resetPage) next.delete("page");
			const query = next.toString();
			router.replace(query ? `/bounties?${query}` : "/bounties", {
				scroll: false,
			});
		},
		[router, searchParams],
	);

	useEffect(() => {
		if (searchInput === urlSearch) return;
		const timeout = window.setTimeout(() => {
			updateUrl({ q: searchInput || null });
		}, 300);
		return () => window.clearTimeout(timeout);
	}, [searchInput, updateUrl, urlSearch]);

	useEffect(() => {
		setSearchInput(urlSearch);
	}, [urlSearch]);

	const input = useMemo(
		() => ({
			search: urlSearch,
			status,
			repository,
			sort,
			page: requestedPage,
			pageSize: PAGE_SIZE,
		}),
		[repository, requestedPage, sort, status, urlSearch],
	);
	const { data, error, isLoading, isPlaceholderData } = useQuery(
		trpc.bounties.list.queryOptions(input, {
			placeholderData: keepPreviousData,
			staleTime: 30_000,
		}),
	);

	useEffect(() => {
		if (data && requestedPage > data.totalPages) {
			updateUrl({ page: String(data.totalPages) }, false);
		}
	}, [data, requestedPage, updateUrl]);

	const hasFilters = Boolean(
		urlSearch || status !== "all" || repository || sort !== "newest",
	);
	const clearFilters = () => {
		setSearchInput("");
		updateUrl({ q: null, status: null, repository: null, sort: null });
	};
	const setPage = (page: number) => updateUrl({ page: String(page) }, false);
	const totalPages = data?.totalPages ?? 1;
	const page = Math.min(requestedPage, totalPages);
	const pageNumbers = Array.from(
		{ length: Math.min(totalPages, 5) },
		(_, index) => {
			if (totalPages <= 5) return index + 1;
			if (page <= 3) return index + 1;
			if (page >= totalPages - 2) return totalPages - 4 + index;
			return page - 2 + index;
		},
	);

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
						<Search className="size-4" /> Find funded work
					</CardTitle>
					<CardDescription>
						Search first, then refine by status, repository, or reward.
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-5">
					<FieldGroup>
						<Field>
							<FieldLabel htmlFor="bounty-search">Search bounties</FieldLabel>
							<InputGroup>
								<InputGroupAddon>
									<Search aria-hidden="true" />
								</InputGroupAddon>
								<InputGroupInput
									aria-label="Search bounties"
									id="bounty-search"
									onChange={(event) => setSearchInput(event.target.value)}
									placeholder="Search by title, repository, or GitHub issue…"
									type="search"
									value={searchInput}
								/>
							</InputGroup>
						</Field>
					</FieldGroup>
					<div className="flex flex-col gap-4 border-t pt-5">
						<div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
							<div className="flex flex-col gap-1">
								<p className="font-medium text-sm">Refine results</p>
								<p className="text-muted-foreground text-xs">
									Use one or more filters to narrow the work list.
								</p>
							</div>
							{hasFilters ? (
								<Button
									className="self-start sm:self-auto"
									onClick={clearFilters}
									size="sm"
									variant="ghost"
								>
									<X data-icon="inline-start" /> Clear filters
								</Button>
							) : null}
						</div>
						<FieldGroup className="grid gap-3 md:grid-cols-3">
							<Field>
								<FieldLabel htmlFor="bounty-status">Status</FieldLabel>
								<Select
									onValueChange={(value) =>
										updateUrl({ status: value === "all" ? null : value })
									}
									value={status}
								>
									<SelectTrigger
										aria-label="Filter by status"
										className="w-full"
										id="bounty-status"
									>
										<SelectValue>{statusLabel(status)}</SelectValue>
									</SelectTrigger>
									<SelectContent>
										{STATUS_VALUES.map((value) => (
											<SelectItem key={value} value={value}>
												{value === "all" ? "All statuses" : statusLabel(value)}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<Field>
								<FieldLabel htmlFor="bounty-repository">Repository</FieldLabel>
								<Select
									onValueChange={(value) =>
										updateUrl({ repository: value === "all" ? null : value })
									}
									value={repository || "all"}
								>
									<SelectTrigger
										aria-label="Filter by repository"
										className="w-full"
										id="bounty-repository"
									>
										<SelectValue>
											{repository || "All repositories"}
										</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="all">All repositories</SelectItem>
										{data?.repositories.map((item) => (
											<SelectItem key={item} value={item}>
												{item}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</Field>
							<Field>
								<FieldLabel htmlFor="bounty-sort">Sort by</FieldLabel>
								<Select
									onValueChange={(value) =>
										updateUrl({ sort: value === "newest" ? null : value })
									}
									value={sort}
								>
									<SelectTrigger
										aria-label="Sort bounties"
										className="w-full"
										id="bounty-sort"
									>
										<SelectValue>{sortLabels[sort]}</SelectValue>
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="newest">Newest first</SelectItem>
										<SelectItem value="oldest">Oldest first</SelectItem>
										<SelectItem value="reward_high">Highest reward</SelectItem>
										<SelectItem value="reward_low">Lowest reward</SelectItem>
									</SelectContent>
								</Select>
							</Field>
						</FieldGroup>
					</div>

					<Separator />
					<div className="flex items-center justify-between gap-3 text-muted-foreground text-xs">
						<div aria-live="polite" className="flex items-center gap-2">
							<ListFilter className="size-3.5" />
							{isLoading
								? "Loading bounties…"
								: `${data?.total ?? 0} ${data?.total === 1 ? "bounty" : "bounties"}`}
							{isPlaceholderData ? " · Updating" : null}
						</div>
						{hasFilters ? (
							<Badge variant="outline">Filtered results</Badge>
						) : null}
					</div>

					{error ? (
						<div className="border border-destructive/30 bg-destructive/5 p-5 text-destructive text-sm">
							We couldn’t load bounties right now. Please try again.
						</div>
					) : isLoading ? (
						<div className="p-8 text-center text-muted-foreground text-sm">
							Loading bounties…
						</div>
					) : !data?.items.length ? (
						<div className="flex flex-col items-center gap-3 p-12 text-center">
							<CircleDollarSign className="size-8 text-muted-foreground" />
							<p className="font-medium">
								{hasFilters
									? "No bounties match these filters"
									: "No funded bounties yet"}
							</p>
							<p className="max-w-md text-muted-foreground text-sm">
								{hasFilters
									? "Try a different search or clear the filters to see every available bounty."
									: "Create the first task and make the payment condition explicit."}
							</p>
							{hasFilters ? (
								<Button onClick={clearFilters} size="sm" variant="outline">
									Clear filters
								</Button>
							) : null}
						</div>
					) : (
						<div className="divide-y">
							{data.items.map((item) => (
								<Link
									className="group flex items-center justify-between gap-5 py-4 transition-colors first:pt-0 last:pb-0 hover:bg-muted/40"
									href={`/bounties/${item.id}`}
									key={item.id}
								>
									<div className="min-w-0">
										<div className="flex flex-wrap items-center gap-2">
											<p className="truncate font-medium">{item.title}</p>
											<Badge variant="outline">
												{statusLabel(item.status)}
											</Badge>
										</div>
										<p className="mt-1 truncate text-muted-foreground text-sm">
											{item.repository} · Issue #{item.issueNumber}
										</p>
									</div>
									<div className="flex shrink-0 items-center gap-5">
										<div className="text-right">
											<UsdAmount amount={item.amount} className="font-medium" />
											<p className="mt-1 text-muted-foreground text-xs">
												{new Date(item.deadline).toLocaleDateString(undefined, {
													month: "short",
													day: "numeric",
													year: "numeric",
												})}
											</p>
										</div>
										<ArrowUpRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
									</div>
								</Link>
							))}
						</div>
					)}

					{data && data.totalPages > 1 ? (
						<div className="flex items-center justify-between gap-3 border-t pt-4">
							<p className="text-muted-foreground text-xs">
								Page {page} of {data.totalPages}
							</p>
							<nav
								aria-label="Bounty pages"
								className="flex items-center gap-1"
							>
								<Button
									aria-label="Previous page"
									disabled={page <= 1}
									onClick={() => setPage(page - 1)}
									size="sm"
									variant="outline"
								>
									<ChevronLeft className="size-3.5" />
									<span className="sr-only sm:not-sr-only">Previous</span>
								</Button>
								{pageNumbers.map((pageNumber) => (
									<Button
										aria-current={pageNumber === page ? "page" : undefined}
										aria-label={`Page ${pageNumber}`}
										key={pageNumber}
										onClick={() => setPage(pageNumber)}
										size="sm"
										variant={pageNumber === page ? "default" : "outline"}
									>
										{pageNumber}
									</Button>
								))}
								<Button
									aria-label="Next page"
									disabled={page >= data.totalPages}
									onClick={() => setPage(page + 1)}
									size="sm"
									variant="outline"
								>
									<span className="sr-only sm:not-sr-only">Next</span>
									<ChevronRight className="size-3.5" />
								</Button>
							</nav>
						</div>
					) : null}
				</CardContent>
			</Card>
		</main>
	);
}

function BountiesFallback() {
	return (
		<main className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-5 py-12">
			<div className="text-muted-foreground text-sm">Loading bounties…</div>
		</main>
	);
}

export default function BountiesPage() {
	return (
		<Suspense fallback={<BountiesFallback />}>
			<BountiesContent />
		</Suspense>
	);
}
