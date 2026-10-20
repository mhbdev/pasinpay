import {
	SOLANA_DEVNET_RPC_URL,
	SOLANA_DEVNET_USDC_MINT,
	SOLANA_TOKEN_PROGRAM_ID,
	solanaDevnetConfigFromEnv,
} from "@pasinpay/solana";
import { createClient } from "@solana/kit";
import { solanaRpcConnection } from "@solana/kit-plugin-rpc";
import { walletSigner } from "@solana/kit-plugin-wallet";

const rpcUrl =
	process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL || SOLANA_DEVNET_RPC_URL;

export const solanaClient = createClient()
	.use(walletSigner({ chain: "solana:devnet" }))
	.use(solanaRpcConnection({ rpcUrl }));

export const solanaWebConfig = solanaDevnetConfigFromEnv({
	PASINPAY_SOLANA_DEVNET_PROGRAM_ID:
		process.env.NEXT_PUBLIC_SOLANA_DEVNET_PROGRAM_ID,
	PASINPAY_SOLANA_DEVNET_RPC_URL: rpcUrl,
});

export const solanaUsdcMint = SOLANA_DEVNET_USDC_MINT;
export const solanaTokenProgramId = SOLANA_TOKEN_PROGRAM_ID;

export function isSolanaDevnetConfigured() {
	return Boolean(solanaWebConfig.programId);
}
