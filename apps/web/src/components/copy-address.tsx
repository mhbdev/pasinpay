"use client";

import { Button } from "@pasinpay/ui/components/button";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

function shortenAddress(address: string) {
	return `${address.slice(0, 10)}…${address.slice(-8)}`;
}

export function useCopyToClipboard() {
	const [copied, setCopied] = useState(false);

	async function copy(value: string, label = "Value") {
		try {
			await navigator.clipboard.writeText(value);
			setCopied(true);
			toast.success(`${label} copied`);
			window.setTimeout(() => setCopied(false), 1600);
		} catch {
			toast.error(`Could not copy ${label.toLowerCase()}`);
		}
	}

	return { copy, copied };
}

export function CopyAddress({
	address,
	href,
	display,
	label = "Address",
	className,
}: {
	address: string;
	href?: string;
	display?: string;
	label?: string;
	className?: string;
}) {
	const { copy, copied } = useCopyToClipboard();
	return (
		<span
			className={`inline-flex max-w-full items-center gap-1.5 ${className ?? ""}`}
		>
			{href ? (
				<a
					className="min-w-0 truncate font-mono text-xs underline-offset-2 hover:underline"
					href={href}
					target="_blank"
					rel="noreferrer"
					title={address}
				>
					{display ?? shortenAddress(address)}
				</a>
			) : (
				<span className="min-w-0 truncate font-mono text-xs" title={address}>
					{display ?? shortenAddress(address)}
				</span>
			)}
			<Button
				aria-label={`Copy ${label.toLowerCase()}`}
				className="shrink-0"
				onClick={() => void copy(address, label)}
				size="icon-xs"
				type="button"
				variant="ghost"
			>
				{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			</Button>
			{href && (
				<Button
					aria-label={`Open ${label.toLowerCase()} in explorer`}
					className="shrink-0"
					render={<a href={href} rel="noreferrer" target="_blank" />}
					size="icon-xs"
					variant="ghost"
				>
					<ExternalLink aria-hidden="true" />
				</Button>
			)}
		</span>
	);
}
