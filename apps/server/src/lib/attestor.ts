import {
	type ClaimMessage,
	claimDomain,
	claimTypes,
	escrowAbi,
	verifyClaimSignature,
} from "@pasinpay/chain";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ENV } from "../env.server";
import { chainConfig, publicClient } from "../services";

const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

export function getConfiguredAttestorAddress(): Address {
	if (!ENV.PASINPAY_ATTESTOR_PRIVATE_KEY)
		throw new Error("PASINPAY_ATTESTOR_PRIVATE_KEY is not configured");
	return privateKeyToAccount(ENV.PASINPAY_ATTESTOR_PRIVATE_KEY as Hex).address;
}

export async function getContractAttestorAddress(
	escrowAddress = chainConfig.escrowAddress,
): Promise<Address> {
	if (escrowAddress === zeroAddress)
		throw new Error("PASINPAY_ESCROW_ADDRESS is not configured");
	return publicClient.readContract({
		address: escrowAddress,
		abi: escrowAbi,
		functionName: "attestor",
	});
}

/**
 * The EIP-712 signer is a contract trust root. Refuse to issue attestations
 * unless the configured private key resolves to the address currently trusted
 * by the deployed escrow.
 */
export async function assertAttestorMatchesContract(
	escrowAddress = chainConfig.escrowAddress,
): Promise<{
	configured: Address;
	onChain: Address;
}> {
	const configured = getConfiguredAttestorAddress();
	const onChain = await getContractAttestorAddress(escrowAddress);
	if (configured.toLowerCase() !== onChain.toLowerCase()) {
		throw new Error(
			`Configured claim attestor ${configured} does not match the escrow attestor ${onChain}`,
		);
	}
	return { configured, onChain };
}

export async function signClaim(
	message: ClaimMessage,
	escrowAddress = chainConfig.escrowAddress,
): Promise<{ signer: Address; signature: Hex }> {
	const { onChain } = await assertAttestorMatchesContract(escrowAddress);
	const account = privateKeyToAccount(ENV.PASINPAY_ATTESTOR_PRIVATE_KEY as Hex);
	const signature = await account.signTypedData({
		domain: claimDomain(chainConfig.id, escrowAddress),
		types: claimTypes,
		primaryType: "Claim",
		message,
	});
	if (
		!(await verifyClaimSignature(
			chainConfig.id,
			escrowAddress,
			message,
			signature,
			onChain,
		))
	) {
		throw new Error(
			"Generated claim attestation failed local signature verification",
		);
	}
	return { signer: account.address, signature };
}
