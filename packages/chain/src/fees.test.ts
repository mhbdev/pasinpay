import { expect, test } from "bun:test";
import { ARBITRUM_SEPOLIA_ID, ARC_MAINNET_ID, ARC_TESTNET_ID } from "./config";
import { getEip1559FeeQuote } from "./fees";

test("Arc fee quotes satisfy the 20 Gwei max fee floor", () => {
	for (const chainId of [ARC_MAINNET_ID, ARC_TESTNET_ID]) {
		expect(
			getEip1559FeeQuote(chainId, BigInt("1000000000"), {
				maxFeePerGas: BigInt("2000000000"),
				maxPriorityFeePerGas: BigInt("100000000"),
			}),
		).toEqual({
			maxFeePerGas: BigInt("20000000000"),
			maxPriorityFeePerGas: BigInt("100000000"),
		});
	}
});

test("non-Arc fee quotes preserve the RPC and base fee estimate", () => {
	expect(
		getEip1559FeeQuote(ARBITRUM_SEPOLIA_ID, BigInt("1000000000"), {
			maxFeePerGas: BigInt("1500000000"),
			maxPriorityFeePerGas: BigInt("100000000"),
		}),
	).toEqual({
		maxFeePerGas: BigInt("2100000000"),
		maxPriorityFeePerGas: BigInt("100000000"),
	});
});
