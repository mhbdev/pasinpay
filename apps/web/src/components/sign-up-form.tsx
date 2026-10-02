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

export default function SignUpForm({
	onSwitchToSignIn,
}: {
	onSwitchToSignIn: () => void;
}) {
	const router = useRouter();
	const { isPending: sessionPending } = authClient.useSession();
	const form = useForm({
		defaultValues: { name: "", email: "", password: "" },
		validators: {
			onSubmit: z.object({
				name: z.string().trim().min(2, "Enter your name."),
				email: z.email("Enter a valid email address."),
				password: z.string().min(8, "Password must be at least 8 characters."),
			}),
		},
		onSubmit: async ({ value }) => {
			await authClient.signUp.email(
				{ name: value.name, email: value.email, password: value.password },
				{
					onSuccess: () => {
						toast.success("Account created");
						router.push("/dashboard");
					},
					onError: (error) => {
						toast.error(error.error.message || "Sign up failed.");
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
					<CardTitle className="text-2xl">Create your account</CardTitle>
					<CardDescription>
						Connect GitHub and a wallet when you are ready to ship.
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
							<form.Field name="name">
								{(field) => (
									<Field data-invalid={field.state.meta.errors.length > 0}>
										<FieldLabel htmlFor={field.name}>Name</FieldLabel>
										<Input
											id={field.name}
											name={field.name}
											autoComplete="name"
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
											autoComplete="new-password"
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
									Create account
								</Button>
							)}
						</form.Subscribe>
					</form>
				</CardContent>
				<CardFooter className="justify-center">
					<Button variant="link" type="button" onClick={onSwitchToSignIn}>
						Already have an account? Sign in
					</Button>
				</CardFooter>
			</Card>
		</main>
	);
}
