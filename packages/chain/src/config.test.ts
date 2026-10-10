import { expect, test } from "bun:test";
import { DEFAULT_CHAIN_CONFIG, supportsX402Funding } from "./config";

test("x402 readiness probes both the escrow adapter and EIP-3009 token", async () => {
	const probes: string[] = [];
	const publicClient = {
		readContract: async ({ functionName }: { functionName: string }) => {
			probes.push(functionName);
			return false;
		},
	} as never;

	expect(await supportsX402Funding(publicClient, DEFAULT_CHAIN_CONFIG)).toBe(
		true,
	);
	expect(probes.sort()).toEqual(["authorizationState", "usedX402Nonces"]);
});

test("x402 readiness fails closed when either protocol interface is missing", async () => {
	const publicClient = {
		readContract: async ({ functionName }: { functionName: string }) => {
			if (functionName === "authorizationState") {
				throw new Error("EIP-3009 interface unavailable");
			}
			return false;
		},
	} as never;

	expect(await supportsX402Funding(publicClient, DEFAULT_CHAIN_CONFIG)).toBe(
		false,
	);
});
