import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@pasinpay/ui/components/alert-dialog";
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
import { toast } from "sonner";
import { useDisconnect } from "wagmi";

import { authClient } from "@/lib/auth-client";
import { WalletMenuAction } from "./wallet-button";

export default function UserMenu() {
	const router = useRouter();
	const [disconnectOpen, setDisconnectOpen] = useState(false);
	const [signOutOpen, setSignOutOpen] = useState(false);
	const [signingOut, setSigningOut] = useState(false);
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
						<AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
							<AlertDialogTrigger
								render={<DropdownMenuItem variant="destructive" />}
							>
								Sign Out
							</AlertDialogTrigger>
							<AlertDialogContent>
								<AlertDialogHeader>
									<AlertDialogTitle>Sign out?</AlertDialogTitle>
									<AlertDialogDescription>
										You will need to sign in again to manage bounties and linked
										identities.
									</AlertDialogDescription>
								</AlertDialogHeader>
								<AlertDialogFooter>
									<AlertDialogCancel disabled={signingOut}>
										Stay signed in
									</AlertDialogCancel>
									<AlertDialogAction
										disabled={signingOut}
										onClick={async () => {
											setSigningOut(true);
											const result = await authClient.signOut();
											if (result.error) {
												const message =
													result.error.message ||
													"Could not sign out. Please try again.";
												toast.error(message);
												setSigningOut(false);
												return;
											}
											setSignOutOpen(false);
											router.push("/");
										}}
									>
										{signingOut ? "Signing out…" : "Sign out"}
									</AlertDialogAction>
								</AlertDialogFooter>
							</AlertDialogContent>
						</AlertDialog>
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
