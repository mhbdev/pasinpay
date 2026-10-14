import type { Eip1559Fees } from "@pasinpay/chain";
import { getEip1559FeeQuote } from "@pasinpay/chain";
import type { PublicClient } from "viem";

export type { Eip1559Fees } from "@pasinpay/chain";

type FeeClient = Pick<
	PublicClient,
	"estimateFeesPerGas" | "getBlock" | "chain"
>;

const MAX_FEE_RETRY_MESSAGE = "max fee per gas less than block base fee";

/**
 * Builds a fee quote from the latest block as well as the RPC fee estimate.
 * Wallet providers can cache eth_gasPrice for a few seconds; using twice the
 * current base fee prevents a valid transaction from becoming stale while the
 * user is reviewing it in the wallet.
 */
export async function getFreshEip1559Fees(
	client: FeeClient,
): Promise<Eip1559Fees> {
	const [block, estimate] = await Promise.all([
		client.getBlock({ blockTag: "latest" }),
		client.estimateFeesPerGas(),
	]);
	const baseFeePerGas =
		block.baseFeePerGas ?? estimate.maxFeePerGas ?? BigInt(0);
	return getEip1559FeeQuote(client.chain?.id ?? 0, baseFeePerGas, estimate);
}

export function isStaleEip1559FeeError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.toLowerCase().includes(MAX_FEE_RETRY_MESSAGE)
	);
}

/**
 * Refreshes fees once when an injected wallet rejects a cached quote. The
 * first attempt is still the normal wallet flow; the retry only applies when
 * the node explicitly reports that the base fee moved during confirmation.
 */
export async function writeWithFreshEip1559Fees<T>(
	client: FeeClient,
	write: (fees: Eip1559Fees) => Promise<T>,
) {
	try {
		return await write(await getFreshEip1559Fees(client));
	} catch (error) {
		if (!isStaleEip1559FeeError(error)) throw error;
		return write(await getFreshEip1559Fees(client));
	}
}
