/**
 * The server runtime uses env.server.ts for validation. This small checked-in
 * contract keeps type checking deterministic on Windows, where Varlock's
 * native codegen helper is not reliable. Linux CI regenerates the richer
 * Varlock files from apps/server/.env.schema.
 */
export type CoercedEnvSchema = {
	NODE_ENV: "development" | "production" | "test";
	BETTER_AUTH_SECRET: string;
	BETTER_AUTH_URL: string;
	CORS_ORIGIN: string;
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	GITHUB_APP_ID: string;
	GITHUB_APP_SLUG: string;
	GITHUB_APP_PRIVATE_KEY: string;
	GITHUB_WEBHOOK_SECRET: string;
	PASINPAY_CHAIN_ID: string;
	PASINPAY_RPC_URL: string;
	PASINPAY_ESCROW_ADDRESS: string;
	PASINPAY_USDG_ADDRESS: string;
	PASINPAY_SEPOLIA_ESCROW_ADDRESS: string;
	PASINPAY_SEPOLIA_USDG_ADDRESS: string;
	PASINPAY_MAINNET_ESCROW_ADDRESS: string;
	PASINPAY_MAINNET_USDG_ADDRESS: string;
	PASINPAY_ATTESTOR_PRIVATE_KEY: string;
	PASINPAY_X402_RELAYER_PRIVATE_KEY: string;
	PASINPAY_FEE_TREASURY_ADDRESS: string;
	PASINPAY_FEE_BPS: string;
	DATABASE_URL: string;
};
