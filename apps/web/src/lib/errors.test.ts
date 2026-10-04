import { describe, expect, test } from "bun:test";

import { getReadableError } from "./errors";

describe("wallet and contract error messages", () => {
	test("turns wallet rejection into a safe recovery message", () => {
		expect(getReadableError(new Error("User rejected the request"))).toBe(
			"Transaction cancelled in your wallet. No funds were moved.",
		);
	});

	test("explains missing gas without exposing provider noise", () => {
		expect(getReadableError(new Error("insufficient funds for gas"))).toBe(
			"Your wallet does not have enough ETH for gas. Add testnet ETH and try again.",
		);
	});

	test("explains an untrusted attestation", () => {
		expect(getReadableError(new Error("0x8baa579f"))).toContain(
			"claim attestation is not trusted",
		);
	});

	test("explains a stale on-chain action", () => {
		expect(getReadableError(new Error("InvalidStatus"))).toContain(
			"changed state on-chain",
		);
	});
});
