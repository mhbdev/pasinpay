import { ARC_MAINNET_ID, ARC_TESTNET_ID } from "./config";

export type Eip1559Fees = {
	maxFeePerGas: bigint;
	maxPriorityFeePerGas: bigint;
};

export type FeeEstimate = {
	maxFeePerGas?: bigint;
	maxPriorityFeePerGas?: bigint;
};

const ARC_MIN_MAX_FEE_PER_GAS = BigInt("20000000000");

function max(...values: bigint[]) {
	return values.reduce((largest, value) => (largest > value ? largest : value));
}

/** Applies the Arc mempool's required minimum max fee while preserving RPC quotes elsewhere. */
export function getEip1559FeeQuote(
	chainId: number,
	baseFeePerGas: bigint,
	estimate: FeeEstimate,
): Eip1559Fees {
	const maxPriorityFeePerGas = estimate.maxPriorityFeePerGas ?? BigInt(0);
	const estimatedMaxFeePerGas = estimate.maxFeePerGas ?? BigInt(0);
	const maxFeePerGas = max(
		estimatedMaxFeePerGas,
		baseFeePerGas * BigInt(2) + maxPriorityFeePerGas,
		...(chainId === ARC_MAINNET_ID || chainId === ARC_TESTNET_ID
			? [ARC_MIN_MAX_FEE_PER_GAS]
			: []),
	);

	return { maxFeePerGas, maxPriorityFeePerGas };
}
