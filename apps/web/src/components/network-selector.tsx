"use client";

import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@pasinpay/ui/components/select";
import { isWebChainConfigured } from "@/lib/wallet";
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
					size="sm"
					className="w-[132px] text-xs sm:w-[190px]"
					title={error ?? undefined}
				>
					<SelectValue>
						{switching ? (
							"Switching…"
						) : (
							<>
								<span className="sm:hidden">
									{chainId === 421614 ? "Sepolia" : "Arbitrum One"}
								</span>
								<span className="hidden sm:inline">{chainConfig.name}</span>
							</>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent className="min-w-[190px]">
					<SelectItem value="421614" disabled={!isWebChainConfigured(421614)}>
						Arbitrum Sepolia · Testnet
					</SelectItem>
					<SelectItem value="42161" disabled={!isWebChainConfigured(42161)}>
						Arbitrum One · Mainnet · not enabled
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}
