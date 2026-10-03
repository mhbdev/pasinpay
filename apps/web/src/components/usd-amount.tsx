"use client";

import { erc20MetadataAbi } from "@pasinpay/chain";
import { formatUnits } from "viem";
import { useReadContract } from "wagmi";
import { useAppNetwork } from "./network-provider";

export function UsdAmount({
	amount,
	className,
}: {
	amount: string;
	className?: string;
}) {
	const { chainConfig } = useAppNetwork();
	const { data: decimals } = useReadContract({
		address: chainConfig.usdgAddress,
		abi: erc20MetadataAbi,
		functionName: "decimals",
		chainId: chainConfig.id,
	});
	const { data: symbol } = useReadContract({
		address: chainConfig.usdgAddress,
		abi: erc20MetadataAbi,
		functionName: "symbol",
		chainId: chainConfig.id,
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
