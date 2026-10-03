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

export default function SignInForm({
	onSwitchToSignUp,
}: {
	onSwitchToSignUp: () => void;
}) {
	const router = useRouter();
	const { isPending: sessionPending } = authClient.useSession();
	const [isSigningIn, setIsSigningIn] = useState(false);

	async function continueWithGithub() {
		setIsSigningIn(true);
		await authClient.signIn.social(
			{
				provider: "github",
				callbackURL: `${window.location.origin}/dashboard`,
				errorCallbackURL: `${window.location.origin}/login?authError=github`,
			},
			{
				onSuccess: () => {
					toast.success("Welcome back");
					router.push("/dashboard");
				},
				onError: (error) => {
					setIsSigningIn(false);
					toast.error(error.error.message || "GitHub sign in failed.");
				},
			},
		);
	}

	if (sessionPending) return <div className="mx-auto w-full max-w-md p-6" />;

	return (
		<main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-12">
			<Card className="w-full">
				<CardHeader>
					<CardTitle className="text-2xl">Welcome back</CardTitle>
					<CardDescription>
						Sign in securely with the GitHub account you use to ship code.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<Button
						className="w-full"
						disabled={isSigningIn}
						onClick={continueWithGithub}
						type="button"
					>
						{isSigningIn ? (
							<Spinner data-icon="inline-start" />
						) : (
							<GitBranch data-icon="inline-start" />
						)}
						Continue with GitHub
					</Button>
				</CardContent>
				<CardFooter className="justify-center">
					<Button variant="link" type="button" onClick={onSwitchToSignUp}>
						New to PasinPay? Create an account with GitHub
					</Button>
				</CardFooter>
			</Card>
		</main>
	);
}
