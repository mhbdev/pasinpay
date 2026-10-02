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
	let value = amount;
	try {
		value = formatUnits(BigInt(amount), decimals ?? 18);
	} catch {}
	return (
		<span className={className}>
			${Number(value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
			USDG
		</span>
	);
}
