import { describe, expect, test } from "bun:test";
import {
	SOLANA_DEVNET_ID,
	SOLANA_DEVNET_RPC_URL,
	SOLANA_DEVNET_USDC_MINT,
	solanaDevnetConfigFromEnv,
} from "./config";

describe("Solana Devnet configuration", () => {
	test("defaults only to the supported Devnet network and official test USDC", () => {
		const config = solanaDevnetConfigFromEnv({ PASINPAY_FEE_BPS: "" });

		expect(config.id).toBe(SOLANA_DEVNET_ID);
		expect(config.rpcUrl).toBe(SOLANA_DEVNET_RPC_URL);
		expect(config.tokenAddress).toBe(SOLANA_DEVNET_USDC_MINT);
		expect(config.feeBps).toBe(250);
		expect(config.programId).toBe("");
		expect(config.feeTreasury).toBe("");
	});

	test("validates configured addresses and caps the platform fee", () => {
		const config = solanaDevnetConfigFromEnv({
			PASINPAY_SOLANA_DEVNET_PROGRAM_ID: "11111111111111111111111111111111",
			PASINPAY_SOLANA_DEVNET_FEE_TREASURY:
				"Sysvar1nstructions1111111111111111111111111",
			PASINPAY_FEE_BPS: "500",
		});

		expect(config.programId).toBe("11111111111111111111111111111111");
		expect(config.feeBps).toBe(500);
		expect(() =>
			solanaDevnetConfigFromEnv({ PASINPAY_FEE_BPS: "501" }),
		).toThrow();
		expect(() =>
			solanaDevnetConfigFromEnv({ PASINPAY_FEE_BPS: "not-a-number" }),
		).toThrow();
		expect(() =>
			solanaDevnetConfigFromEnv({
				PASINPAY_SOLANA_DEVNET_PROGRAM_ID: "not-an-address",
			}),
		).toThrow();
	});
});
