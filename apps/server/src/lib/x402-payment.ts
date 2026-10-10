import { keccak256, stringToHex } from "viem";

type X402PaymentIdentity = {
	resource: string;
	bountyId: string;
	payer: string;
	amount: bigint;
	validAfter: bigint;
	validBefore: bigint;
	nonce: string;
	tokenSignature: string;
	fundingIntentSignature: string;
};

export function hashX402Payment(identity: X402PaymentIdentity) {
	return keccak256(
		stringToHex(
			JSON.stringify({
				resource: identity.resource,
				bountyId: identity.bountyId,
				payer: identity.payer.toLowerCase(),
				amount: identity.amount.toString(),
				validAfter: identity.validAfter.toString(),
				validBefore: identity.validBefore.toString(),
				nonce: identity.nonce.toLowerCase(),
				tokenSignature: identity.tokenSignature.toLowerCase(),
				fundingIntentSignature: identity.fundingIntentSignature.toLowerCase(),
			}),
		),
	);
}
