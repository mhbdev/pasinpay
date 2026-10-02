"use client";

import { Skeleton } from "@pasinpay/ui/components/skeleton";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { authClient } from "@/lib/auth-client";

export function AuthGuard({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const pathname = usePathname();
	const { data: session, isPending } = authClient.useSession();

	useEffect(() => {
		if (!isPending && !session) {
			router.replace(`/login?callbackURL=${encodeURIComponent(pathname)}`);
		}
	}, [isPending, pathname, router, session]);

	if (isPending || !session) {
		return (
			<main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-5 py-12">
				<Skeleton className="h-10 w-56" />
				<Skeleton className="h-24 w-full" />
			</main>
		);
	}

	return children;
}
