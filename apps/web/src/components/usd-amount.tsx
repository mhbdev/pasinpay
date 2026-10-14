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
	chainConfig?: Pick<ChainConfig, "id" | "tokenAddress" | "tokenSymbol">;
}) {
	const { chainConfig: selectedChainConfig, ready } = useAppNetwork();
	const chainConfig = requestedChainConfig ?? selectedChainConfig;
	const { data: decimals } = useReadContract({
		address: chainConfig.tokenAddress,
		abi: erc20MetadataAbi,
		functionName: "decimals",
		chainId: chainConfig.id,
	});
	const { data: symbol } = useReadContract({
		address: chainConfig.tokenAddress,
		abi: erc20MetadataAbi,
		functionName: "symbol",
		chainId: chainConfig.id,
	});
	let value: string | null = null;
	try {
		if (ready && decimals !== undefined && symbol === chainConfig.tokenSymbol) {
			value = formatUnits(BigInt(amount), decimals);
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
