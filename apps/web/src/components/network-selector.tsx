"use client";

import {
	ARBITRUM_ID,
	ARBITRUM_SEPOLIA_ID,
	ARC_MAINNET_ID,
	ARC_TESTNET_ID,
} from "@pasinpay/chain";
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
				value={ready ? String(chainId) : String(ARBITRUM_SEPOLIA_ID)}
				onValueChange={(value) => {
					if (value) void selectNetwork(Number(value) as typeof chainId);
				}}
				disabled={!ready || switching}
			>
				<SelectTrigger
					aria-label="Select blockchain network"
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
									{chainId === ARC_MAINNET_ID
										? "Arc"
										: chainId === ARC_TESTNET_ID
											? "Arc Testnet"
											: chainId === ARBITRUM_SEPOLIA_ID
												? "Sepolia"
												: "Arbitrum One"}
								</span>
								<span className="hidden sm:inline">{chainConfig.name}</span>
							</>
						)}
					</SelectValue>
				</SelectTrigger>
				<SelectContent className="min-w-[190px]">
					<SelectItem
						value={String(ARBITRUM_SEPOLIA_ID)}
						disabled={!isWebChainConfigured(ARBITRUM_SEPOLIA_ID)}
					>
						Arbitrum Sepolia · Testnet
					</SelectItem>
					<SelectItem
						value={String(ARBITRUM_ID)}
						disabled={!isWebChainConfigured(ARBITRUM_ID)}
					>
						Arbitrum One · Mainnet
					</SelectItem>
					<SelectItem
						value={String(ARC_TESTNET_ID)}
						disabled={!isWebChainConfigured(ARC_TESTNET_ID)}
					>
						Arc Testnet
					</SelectItem>
					<SelectItem
						value={String(ARC_MAINNET_ID)}
						disabled={!isWebChainConfigured(ARC_MAINNET_ID)}
					>
						Arc · Mainnet
					</SelectItem>
				</SelectContent>
			</Select>
		</div>
	);
}
