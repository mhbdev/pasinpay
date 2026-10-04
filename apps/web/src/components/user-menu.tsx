import { Button } from "@pasinpay/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@pasinpay/ui/components/dialog";
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
import { useState } from "react";
import { useDisconnect } from "wagmi";

import { authClient } from "@/lib/auth-client";
import { WalletMenuAction } from "./wallet-button";

export default function UserMenu() {
	const router = useRouter();
	const [disconnectOpen, setDisconnectOpen] = useState(false);
	const { disconnect } = useDisconnect();
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
		<>
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
						<WalletMenuAction
							onDisconnectRequest={() => setDisconnectOpen(true)}
						/>
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
			<Dialog open={disconnectOpen} onOpenChange={setDisconnectOpen}>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>Disconnect wallet?</DialogTitle>
						<DialogDescription>
							Your wallet will be disconnected from this browser session. Your
							PasinPay account link remains unchanged.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<DialogClose render={<Button variant="outline" />}>
							Keep connected
						</DialogClose>
						<Button
							variant="destructive"
							onClick={() => {
								disconnect();
								setDisconnectOpen(false);
							}}
						>
							Disconnect wallet
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	);
}
