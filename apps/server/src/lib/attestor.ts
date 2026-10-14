import {
	type ClaimMessage,
	claimDomain,
	claimTypes,
	escrowAbi,
	verifyClaimSignature,
} from "@pasinpay/chain";
import type { Address, Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { type ChainRuntime, defaultRuntime } from "../services";

const zeroAddress = "0x0000000000000000000000000000000000000000" as Address;

export function getConfiguredAttestorAddress(
	runtime = defaultRuntime,
): Address {
	if (!runtime.attestorPrivateKey)
		throw new Error(
			`Claim attestor is not configured for ${runtime.config.name}`,
		);
	return privateKeyToAccount(runtime.attestorPrivateKey as Hex).address;
}

export async function getContractAttestorAddress(
	runtime: ChainRuntime = defaultRuntime,
): Promise<Address> {
	const escrowAddress = runtime.config.escrowAddress;
	if (escrowAddress === zeroAddress)
		throw new Error("PASINPAY_ESCROW_ADDRESS is not configured");
	return runtime.publicClient.readContract({
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
	runtime: ChainRuntime = defaultRuntime,
): Promise<{
	configured: Address;
	onChain: Address;
}> {
	const configured = getConfiguredAttestorAddress(runtime);
	const onChain = await getContractAttestorAddress(runtime);
	if (configured.toLowerCase() !== onChain.toLowerCase()) {
		throw new Error(
			`Configured claim attestor ${configured} does not match the escrow attestor ${onChain}`,
		);
	}
	return { configured, onChain };
}

export async function signClaim(
	message: ClaimMessage,
	runtime: ChainRuntime = defaultRuntime,
): Promise<{ signer: Address; signature: Hex }> {
	const escrowAddress = runtime.config.escrowAddress;
	const { onChain } = await assertAttestorMatchesContract(runtime);
	const account = privateKeyToAccount(runtime.attestorPrivateKey as Hex);
	const signature = await account.signTypedData({
		domain: claimDomain(runtime.config.id, escrowAddress),
		types: claimTypes,
		primaryType: "Claim",
		message,
	});
	if (
		!(await verifyClaimSignature(
			runtime.config.id,
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
