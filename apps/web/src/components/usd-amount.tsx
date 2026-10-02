"use client";

import { erc20MetadataAbi } from "@pasinpay/chain";
import { formatUnits } from "viem";
import { useReadContract } from "wagmi";
import { webChainConfig } from "@/lib/wallet";

export function UsdAmount({
	amount,
	className,
}: {
	amount: string;
	className?: string;
}) {
	const { data: decimals } = useReadContract({
		address: webChainConfig.usdgAddress,
		abi: erc20MetadataAbi,
		functionName: "decimals",
		chainId: webChainConfig.id,
	});
	const { data: symbol } = useReadContract({
		address: webChainConfig.usdgAddress,
		abi: erc20MetadataAbi,
		functionName: "symbol",
		chainId: webChainConfig.id,
	});
	let value: string | null = null;
	try {
		if (decimals !== undefined && symbol === "USDG") {
			value = formatUnits(BigInt(amount), decimals);
		}
	} catch {}
	return (
		<span className={className}>
			{value === null
				? "—"
				: `$${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}{" "}
			USDG
		</span>
	);
}
