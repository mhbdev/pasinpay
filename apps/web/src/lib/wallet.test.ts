import { expect, test } from "bun:test";
import {
	ARC_MAINNET_ID,
	ARC_TESTNET_CONFIG,
	ARC_TESTNET_ID,
	SUPPORTED_CHAIN_IDS,
} from "@pasinpay/chain";
import {
	defaultWebChainId,
	isWebChainConfigured,
	walletConfig,
	webChainConfigs,
} from "./wallet";

test("the web client enables each deployed testnet and keeps undeployed mainnets disabled", () => {
	expect(isWebChainConfigured(defaultWebChainId)).toBe(true);
	expect(isWebChainConfigured(421614)).toBe(true);
	expect(isWebChainConfigured(ARC_TESTNET_ID)).toBe(true);
	expect(isWebChainConfigured(42161)).toBe(false);
	expect(isWebChainConfigured(ARC_MAINNET_ID)).toBe(false);
});

test("Arc wallet networks use the official Arc USDC configuration", () => {
	expect(SUPPORTED_CHAIN_IDS).toContain(ARC_TESTNET_ID);
	expect(SUPPORTED_CHAIN_IDS).toContain(ARC_MAINNET_ID);
	expect(walletConfig.chains.map((chain) => chain.id)).toContain(
		ARC_TESTNET_ID,
	);
	expect(walletConfig.chains.map((chain) => chain.id)).toContain(
		ARC_MAINNET_ID,
	);
	for (const chainId of [ARC_TESTNET_ID, ARC_MAINNET_ID] as const) {
		expect(webChainConfigs[chainId]).toMatchObject({
			tokenAddress: "0x3600000000000000000000000000000000000000",
			tokenSymbol: "USDC",
			tokenEip712Name: "USDC",
			tokenEip712Version: "2",
		});
	}
	expect(webChainConfigs[ARC_TESTNET_ID].escrowAddress).toBe(
		ARC_TESTNET_CONFIG.escrowAddress,
	);
	expect(webChainConfigs[ARC_TESTNET_ID].feeTreasury).toBe(
		ARC_TESTNET_CONFIG.feeTreasury,
	);
	expect(webChainConfigs[ARC_MAINNET_ID].escrowAddress).toBe(
		"0x0000000000000000000000000000000000000000",
	);
});
