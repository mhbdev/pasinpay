"use client";

import { Button } from "@pasinpay/ui/components/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@pasinpay/ui/components/card";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function McpConsentPage() {
	const [status, setStatus] = useState<
		"checking" | "idle" | "sending" | "done" | "error"
	>("checking");
	const [error, setError] = useState("");
	const [clientId, setClientId] = useState("External coding agent");
	const [scopes, setScopes] = useState(["bounties:read"]);
	const [claims, setClaims] = useState<string | null>(null);

	useEffect(() => {
		const params = new URLSearchParams(window.location.search);
		const requestedClientId = params.get("client_id");
		if (!requestedClientId) {
			setStatus("error");
			setError("This authorization request is missing its client ID.");
			return;
		}
		void authClient.oauth2
			.publicClientPrelogin({ client_id: requestedClientId })
			.then(({ error: validationError }) => {
				if (validationError)
					throw new Error("This authorization request is invalid or expired.");
				setClientId(requestedClientId);
				setScopes(
					(params.get("scope") ?? "bounties:read").split(/\s+/).filter(Boolean),
				);
				setClaims(params.get("claims"));
				setStatus("idle");
			})
			.catch((cause: unknown) => {
				setStatus("error");
				setError(
					cause instanceof Error
						? cause.message
						: "This authorization request is invalid or expired.",
				);
			});
	}, []);

	async function respond(accept: boolean) {
		setStatus("sending");
		setError("");
		try {
			const result = await authClient.oauth2.consent({
				accept,
				scope: scopes.join(" "),
				...(claims
					? { claims: JSON.parse(claims) as Record<string, unknown> }
					: {}),
			});
			if (result.error)
				throw new Error(result.error.message ?? "Authorization failed.");
			setStatus("done");
		} catch (cause) {
			setStatus("error");
			setError(
				cause instanceof Error ? cause.message : "Authorization failed.",
			);
		}
	}

	return (
		<main className="mx-auto flex min-h-[70vh] max-w-xl items-center px-5 py-16">
			<Card className="w-full">
				<CardHeader>
					<div className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary">
						<ShieldCheck aria-hidden="true" />
					</div>
					<CardTitle>
						{status === "done"
							? "Authorization recorded"
							: "Connect an agent to PasinPay"}
					</CardTitle>
					<CardDescription>
						{status === "done"
							? "Return to your coding agent to continue. It can only use the scopes you approved."
							: status === "checking"
								? "Verifying the authorization request…"
								: `${clientId} is requesting access to your PasinPay account.`}
					</CardDescription>
				</CardHeader>
				<CardContent className="flex flex-col gap-5">
					{status !== "done" && status !== "checking" && status !== "error" && (
						<>
							<div className="rounded-lg border p-4">
								<p className="font-medium text-sm">Requested access</p>
								<ul className="mt-3 flex flex-col gap-2 text-muted-foreground text-sm">
									{scopes.map((scope) => (
										<li key={scope}>
											<span className="font-mono text-foreground">{scope}</span>
											{scope === "bounties:read" &&
												" — search and read bounty details"}
											{scope === "bounties:write" &&
												" — prepare a draft for you to review"}
										</li>
									))}
								</ul>
							</div>
							<p className="text-muted-foreground text-sm leading-6">
								This does not let the agent move money or use your wallet. You
								approve every bounty and payment in PasinPay.
							</p>
							{error && (
								<p role="alert" className="text-destructive text-sm">
									{error}
								</p>
							)}
							<div className="flex flex-wrap gap-3">
								<Button
									disabled={status !== "idle"}
									onClick={() => void respond(true)}
								>
									{status === "sending" ? "Saving…" : "Allow access"}
								</Button>
								<Button
									disabled={status !== "idle"}
									variant="outline"
									onClick={() => void respond(false)}
								>
									Deny
								</Button>
							</div>
						</>
					)}
					{status === "checking" && (
						<p className="text-muted-foreground text-sm">
							Checking the signed authorization request…
						</p>
					)}
					{status === "error" && (
						<p role="alert" className="text-destructive text-sm">
							{error}
						</p>
					)}
					<Button
						render={<Link href="/" />}
						nativeButton={false}
						variant="ghost"
						className="w-fit px-0"
					>
						Back to PasinPay
					</Button>
				</CardContent>
			</Card>
		</main>
	);
}
