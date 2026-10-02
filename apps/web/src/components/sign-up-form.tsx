"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { Spinner } from "@pasinpay/ui/components/spinner";
import { GitBranch } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function SignUpForm({
	onSwitchToSignIn,
}: {
	onSwitchToSignIn: () => void;
}) {
	const router = useRouter();
	const { isPending: sessionPending } = authClient.useSession();
	const [isSigningUp, setIsSigningUp] = useState(false);

	async function continueWithGithub() {
		setIsSigningUp(true);
		await authClient.signIn.social(
			{ provider: "github", callbackURL: "/dashboard" },
			{
				onSuccess: () => {
					toast.success("Your PasinPay account is ready");
					router.push("/dashboard");
				},
				onError: (error) => {
					setIsSigningUp(false);
					toast.error(error.error.message || "GitHub sign up failed.");
				},
			},
		);
	}

	if (sessionPending) return <div className="mx-auto w-full max-w-md p-6" />;

	return (
		<main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-12">
			<Card className="w-full">
				<CardHeader>
					<CardTitle className="text-2xl">
						Create your PasinPay account
					</CardTitle>
					<CardDescription>
						Use GitHub to create an account. No email verification or password
						is required.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						className="w-full"
						disabled={isSigningUp}
						onClick={continueWithGithub}
						type="button"
					>
						{isSigningUp ? (
							<Spinner data-icon="inline-start" />
						) : (
							<GitBranch data-icon="inline-start" />
						)}
						Continue with GitHub
					</Button>
				</CardContent>
				<CardFooter className="justify-center">
					<Button variant="link" type="button" onClick={onSwitchToSignIn}>
						Already have an account? Sign in with GitHub
					</Button>
				</CardFooter>
			</Card>
		</main>
	);
}
