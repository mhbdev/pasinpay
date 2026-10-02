import { type ClaimMessage, claimDomain, claimTypes } from "@pasinpay/chain";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ENV } from "../env.server";
import { chainConfig } from "../services";

export async function signClaim(
	message: ClaimMessage,
): Promise<{ signer: Address; signature: Hex }> {
	if (!ENV.PASINPAY_ATTESTOR_PRIVATE_KEY)
		throw new Error("PASINPAY_ATTESTOR_PRIVATE_KEY is not configured");
	const account = privateKeyToAccount(ENV.PASINPAY_ATTESTOR_PRIVATE_KEY as Hex);
	const signature = await account.signTypedData({
		domain: claimDomain(chainConfig.id, chainConfig.escrowAddress),
		types: claimTypes,
		primaryType: "Claim",
		message,
	});
	return { signer: account.address, signature };
}
