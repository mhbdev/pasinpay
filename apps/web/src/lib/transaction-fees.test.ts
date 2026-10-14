import { expect, test } from "bun:test";
import { getFreshEip1559Fees } from "./transaction-fees";

function feeClient(chainId: number) {
	return {
		chain: { id: chainId },
		getBlock: async () => ({ baseFeePerGas: BigInt("1000000000") }),
		estimateFeesPerGas: async () => ({
			maxFeePerGas: BigInt("2000000000"),
			maxPriorityFeePerGas: BigInt("100000000"),
		}),
	} as never;
}

test("Arc transactions meet the network's 20 gwei max fee floor", async () => {
	for (const chainId of [5042, 5042002]) {
		const fees = await getFreshEip1559Fees(feeClient(chainId));
		expect(fees.maxFeePerGas).toBe(BigInt("20000000000"));
		expect(fees.maxPriorityFeePerGas).toBe(BigInt("100000000"));
	}
});

test("Arbitrum fee estimates are unchanged", async () => {
	const fees = await getFreshEip1559Fees(feeClient(421614));
	expect(fees.maxFeePerGas).toBe(BigInt("2100000000"));
	expect(fees.maxPriorityFeePerGas).toBe(BigInt("100000000"));
});
