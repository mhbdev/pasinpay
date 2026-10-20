"use client";

import { type ChainConfig, erc20MetadataAbi } from "@pasinpay/chain";
import { formatUnits } from "viem";
import { useReadContract } from "wagmi";
import { useAppNetwork } from "./network-provider";

export function UsdAmount({
	amount,
	className,
	chainConfig: requestedChainConfig,
}: {
	amount: string;
	className?: string;
	chainConfig?: { id: number; tokenAddress: string; tokenSymbol: string };
}) {
	const { chainConfig: selectedChainConfig, ready } = useAppNetwork();
	const chainConfig = requestedChainConfig ?? selectedChainConfig;
	const isSolana = chainConfig.id === 103;
	const evmConfig = isSolana ? selectedChainConfig : chainConfig;
	const { data: decimals } = useReadContract({
		address: evmConfig.tokenAddress as ChainConfig["tokenAddress"],
		abi: erc20MetadataAbi,
		functionName: "decimals",
		chainId: evmConfig.id,
		query: { enabled: ready && !isSolana },
	});
	const { data: symbol } = useReadContract({
		address: evmConfig.tokenAddress as ChainConfig["tokenAddress"],
		abi: erc20MetadataAbi,
		functionName: "symbol",
		chainId: evmConfig.id,
		query: { enabled: ready && !isSolana },
	});
	const tokenDecimals = isSolana ? 6 : decimals;
	const tokenSymbol = isSolana ? "USDC" : symbol;
	let value: string | null = null;
	try {
		if (
			ready &&
			tokenDecimals !== undefined &&
			tokenSymbol === chainConfig.tokenSymbol
		) {
			value = formatUnits(BigInt(amount), tokenDecimals);
		}
	} catch {}
	return (
		<span className={className}>
			{value === null
				? "—"
				: `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}{" "}
			{chainConfig.tokenSymbol}
		</span>
	);
}
