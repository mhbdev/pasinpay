import { expect, test } from "bun:test";
import {
	ARBITRUM_ID,
	ARBITRUM_SEPOLIA_ID,
	ARC_MAINNET_ID,
	ARC_TESTNET_ID,
	ARC_USDC,
	assertConfiguredToken,
	chainConfigFromEnv,
	chains,
	DEFAULT_CHAIN_CONFIG,
	PASINPAY_ESCROW_ARC_TESTNET,
	PASINPAY_FEE_TREASURY_TESTNET,
	SUPPORTED_CHAIN_IDS,
	supportsX402Funding,
} from "./config";

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

test("Arc chains have their official IDs, RPCs, explorers, and native gas token", () => {
	expect(chains[ARC_MAINNET_ID]).toMatchObject({
		id: ARC_MAINNET_ID,
		name: "Arc",
		nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
		rpcUrls: { default: { http: ["https://rpc.mainnet.arc.io"] } },
		blockExplorers: {
			default: { url: "https://explorer.arc.io" },
		},
	});
	expect(chains[ARC_TESTNET_ID]).toMatchObject({
		id: ARC_TESTNET_ID,
		name: "Arc Testnet",
		nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
		rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } },
		blockExplorers: {
			default: { url: "https://explorer.testnet.arc.io" },
		},
	});
});

test("environment config supports all configured networks and Arc ERC-20 USDC", () => {
	const arcTestnet = chainConfigFromEnv({
		PASINPAY_CHAIN_ID: String(ARC_TESTNET_ID),
	});
	const arcMainnet = chainConfigFromEnv({
		PASINPAY_CHAIN_ID: String(ARC_MAINNET_ID),
	});

	expect(SUPPORTED_CHAIN_IDS).toEqual([
		ARBITRUM_SEPOLIA_ID,
		ARBITRUM_ID,
		ARC_TESTNET_ID,
		ARC_MAINNET_ID,
	]);
	for (const config of [arcTestnet, arcMainnet]) {
		expect(config.tokenAddress).toBe(ARC_USDC);
		expect(config.tokenSymbol).toBe("USDC");
		expect(config.tokenEip712Name).toBe("USDC");
		expect(config.tokenEip712Version).toBe("2");
	}
	expect(arcTestnet.escrowAddress).toBe(PASINPAY_ESCROW_ARC_TESTNET);
	expect(arcTestnet.feeTreasury).toBe(PASINPAY_FEE_TREASURY_TESTNET);
	expect(arcMainnet.escrowAddress).toBe(
		"0x0000000000000000000000000000000000000000",
	);
	expect(arcTestnet.rpcUrl).toBe("https://rpc.testnet.arc.io");
	expect(arcTestnet.explorerUrl).toBe("https://explorer.testnet.arc.io");
	expect(arcMainnet.rpcUrl).toBe("https://rpc.mainnet.arc.io");
	expect(arcMainnet.explorerUrl).toBe("https://explorer.arc.io");
});

test("chain-specific escrow and token configuration wins over legacy Arbitrum defaults", () => {
	const config = chainConfigFromEnv({
		PASINPAY_CHAIN_ID: String(ARC_TESTNET_ID),
		PASINPAY_ESCROW_ADDRESS: "0x0000000000000000000000000000000000000001",
		PASINPAY_ARC_TESTNET_ESCROW_ADDRESS:
			"0x0000000000000000000000000000000000000002",
		PASINPAY_ARC_TESTNET_TOKEN_ADDRESS:
			"0x0000000000000000000000000000000000000003",
		PASINPAY_USDG_ADDRESS: "0x0000000000000000000000000000000000000004",
	});
	expect(config.escrowAddress).toBe(
		"0x0000000000000000000000000000000000000002",
	);
	expect(config.tokenAddress).toBe(
		"0x0000000000000000000000000000000000000003",
	);
});

test("Arc token validation requires USDC with six ERC-20 decimals", async () => {
	const config = chainConfigFromEnv({
		PASINPAY_CHAIN_ID: String(ARC_TESTNET_ID),
	});
	const publicClient = {
		readContract: async ({ functionName }: { functionName: string }) =>
			functionName === "symbol" ? "USDC" : 6,
	} as never;

	expect(await assertConfiguredToken(publicClient, config)).toEqual({
		symbol: "USDC",
		decimals: 6,
	});

	const invalidDecimalsClient = {
		readContract: async ({ functionName }: { functionName: string }) =>
			functionName === "symbol" ? "USDC" : 18,
	} as never;
	await expect(
		assertConfiguredToken(invalidDecimalsClient, config),
	).rejects.toThrow("Arc USDC must use 6 ERC-20 decimals");
});
