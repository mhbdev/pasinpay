import { expect, test } from "bun:test";
import { hashX402Payment } from "./x402-payment";

const payment = {
	resource: "https://api.pasinpay.test/api/x402/bounties/id/fund",
	bountyId: "id",
	payer: "0x1111111111111111111111111111111111111111",
	amount: 1025n,
	validAfter: 100n,
	validBefore: 200n,
	nonce: `0x${"a".repeat(64)}`,
	tokenSignature: `0x${"b".repeat(130)}`,
	fundingIntentSignature: `0x${"c".repeat(130)}`,
};

test("x402 payment identity is stable across normalized hex casing", () => {
	expect(
		hashX402Payment({
			...payment,
			payer: payment.payer.toUpperCase().replace("0X", "0x"),
			nonce: payment.nonce.toUpperCase().replace("0X", "0x"),
			tokenSignature: payment.tokenSignature.toUpperCase().replace("0X", "0x"),
		}),
	).toBe(hashX402Payment(payment));
});

test("x402 payment identity is bound to bounty, amount, and signatures", () => {
	const baseline = hashX402Payment(payment);
	expect(hashX402Payment({ ...payment, bountyId: "other" })).not.toBe(baseline);
	expect(hashX402Payment({ ...payment, amount: 1026n })).not.toBe(baseline);
	expect(
		hashX402Payment({
			...payment,
			fundingIntentSignature: `0x${"d".repeat(130)}`,
		}),
	).not.toBe(baseline);
});
