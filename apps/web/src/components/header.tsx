"use client";
import Image from "next/image";
import Link from "next/link";
import { authClient } from "@/lib/auth-client";
import { ModeToggle } from "./mode-toggle";
import UserMenu from "./user-menu";
import { WalletButton } from "./wallet-button";

export default function Header() {
	const { data: session, isPending } = authClient.useSession();
	const links = [
		{ to: "/bounties", label: "Bounties" },
		{ to: "/dashboard", label: "Dashboard" },
	] as const;

	return (
		<header className="border-b bg-background/95">
			<div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
				<div className="flex items-center gap-8">
					<Link
						href="/"
						className="flex items-center gap-2 font-semibold tracking-tight"
					>
						<Image
							src="/brand/pasinpay-mark.png"
							alt=""
							width={28}
							height={28}
							className="size-7 object-contain"
							priority
						/>
						PasinPay
					</Link>
					<nav className="hidden gap-5 text-muted-foreground text-sm sm:flex">
						{links.map(({ to, label }) => {
							return (
								<Link
									className="transition-colors hover:text-foreground"
									key={to}
									href={to}
								>
									{label}
								</Link>
							);
						})}
					</nav>
				</div>
				<div className="flex items-center gap-2">
					{!isPending && session && <WalletButton />}
					<ModeToggle />
					<UserMenu />
				</div>
			</div>
		</header>
	);
}
