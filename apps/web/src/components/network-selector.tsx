"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@pasinpay/ui/components/select";
import { useAppNetwork } from "./network-provider";

export function NetworkSelector() {
	const { chainId, chainConfig, error, ready, selectNetwork, switching } =
		useAppNetwork();

	return (
		<div className="flex items-center">
			<Select
				value={ready ? String(chainId) : String(421614)}
				onValueChange={(value) => {
					if (value) void selectNetwork(Number(value) as typeof chainId);
				}}
				disabled={!ready || switching}
			>
				<SelectTrigger
					aria-label="Select Arbitrum network"
					className="h-8 w-[140px] text-xs"
					title={error ?? undefined}
				>
					<SelectValue>
						{switching ? "Switching…" : chainConfig.name}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="421614">Arbitrum Sepolia · Testnet</SelectItem>
					<SelectItem value="42161">Arbitrum One · Mainnet</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}
