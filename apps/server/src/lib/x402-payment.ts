import { keccak256, stringToHex } from "viem";

const bountyIdPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidX402BountyId(value: string) {
	return bountyIdPattern.test(value);
}

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
