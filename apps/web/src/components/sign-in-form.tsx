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
import {
	Field,
	FieldDescription,
	FieldError,
	FieldGroup,
	FieldLabel,
	FieldSeparator,
} from "@pasinpay/ui/components/field";
import { Input } from "@pasinpay/ui/components/input";
import { Spinner } from "@pasinpay/ui/components/spinner";
import { useForm } from "@tanstack/react-form";
import { GitBranch } from "lucide-react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

export default function SignInForm({
	onSwitchToSignUp,
}: {
	onSwitchToSignUp: () => void;
}) {
	const router = useRouter();
	const { isPending: sessionPending } = authClient.useSession();
	const form = useForm({
		defaultValues: { email: "", password: "" },
		validators: {
			onSubmit: z.object({
				email: z.email("Enter a valid email address."),
				password: z.string().min(8, "Password must be at least 8 characters."),
			}),
		},
		onSubmit: async ({ value }) => {
			await authClient.signIn.email(
				{ email: value.email, password: value.password },
				{
					onSuccess: () => {
						toast.success("Welcome back");
						router.push("/dashboard");
					},
					onError: (error) => {
						toast.error(error.error.message || "Sign in failed.");
					},
				},
			);
		},
	});

	if (sessionPending) return <div className="mx-auto w-full max-w-md p-6" />;

	return (
		<main className="mx-auto flex w-full max-w-md flex-1 items-center px-5 py-12">
			<Card className="w-full">
				<CardHeader>
					<CardTitle className="text-2xl">Welcome back</CardTitle>
					<CardDescription>
						Sign in to manage bounties and settlements.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						onSubmit={(event) => {
							event.preventDefault();
							form.handleSubmit();
						}}
					>
						<FieldGroup>
							<form.Field name="email">
								{(field) => (
									<Field data-invalid={field.state.meta.errors.length > 0}>
										<FieldLabel htmlFor={field.name}>Email</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											type="email"
											autoComplete="email"
											value={field.state.value}
											aria-invalid={field.state.meta.errors.length > 0}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
										/>
										<FieldError errors={field.state.meta.errors} />
									</Field>
								)}
							</form.Field>
							<form.Field name="password">
								{(field) => (
									<Field data-invalid={field.state.meta.errors.length > 0}>
										<FieldLabel htmlFor={field.name}>Password</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											type="password"
											autoComplete="current-password"
											value={field.state.value}
											aria-invalid={field.state.meta.errors.length > 0}
											onBlur={field.handleBlur}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
										/>
										<FieldDescription>
											Use at least 8 characters.
										</FieldDescription>
										<FieldError errors={field.state.meta.errors} />
									</Field>
								)}
							</form.Field>
						</FieldGroup>
						<FieldSeparator>or continue with</FieldSeparator>
						<Button
							className="w-full"
							variant="outline"
							type="button"
							onClick={() =>
								authClient.signIn.social({
									provider: "github",
									callbackURL: "/dashboard",
								})
							}
						>
							<GitBranch data-icon="inline-start" /> Continue with GitHub
						</Button>
						<form.Subscribe
							selector={(state) => ({
								canSubmit: state.canSubmit,
								isSubmitting: state.isSubmitting,
							})}
						>
							{({ canSubmit, isSubmitting }) => (
								<Button
									className="mt-5 w-full"
									disabled={!canSubmit || isSubmitting}
									type="submit"
								>
									{isSubmitting ? <Spinner data-icon="inline-start" /> : null}{" "}
									Sign in
								</Button>
							)}
						</form.Subscribe>
					</form>
				</CardContent>
				<CardFooter className="justify-center">
					<Button variant="link" type="button" onClick={onSwitchToSignUp}>
						Need an account? Sign up
					</Button>
				</CardFooter>
			</Card>
		</main>
	);
}
