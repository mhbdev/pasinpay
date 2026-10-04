import { Button } from "@pasinpay/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@pasinpay/ui/components/dropdown-menu";
import { Skeleton } from "@pasinpay/ui/components/skeleton";
import { Settings, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth-client";
import { WalletMenuAction } from "./wallet-button";

export default function UserMenu() {
	const router = useRouter();
	const { data: session, isPending } = authClient.useSession();

	if (isPending) {
		return <Skeleton className="h-7 w-24" />;
	}

	if (!session) {
		return (
			<Link href="/login">
				<Button variant="outline" size="sm">
					Sign In
				</Button>
			</Link>
		);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
				<UserRound data-icon="inline-start" />
				<span className="hidden max-w-24 truncate sm:inline">
					{session.user.name}
				</span>
				<span className="sr-only">Account menu</span>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-72 bg-card">
				<DropdownMenuGroup>
					<DropdownMenuLabel className="flex flex-col gap-1">
						<span className="font-medium text-foreground">My Account</span>
						<span className="truncate">{session.user.email}</span>
					</DropdownMenuLabel>
					<DropdownMenuSeparator />
					<WalletMenuAction />
					<DropdownMenuSeparator />
					<DropdownMenuItem render={<Link href="/settings" />}>
						<Settings />
						Settings
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						onClick={() => {
							authClient.signOut({
								fetchOptions: {
									onSuccess: () => {
										router.push("/");
									},
								},
							});
						}}
					>
						Sign Out
					</DropdownMenuItem>
				</DropdownMenuGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
