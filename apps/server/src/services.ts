import { createAuth } from "@pasinpay/auth";
import { arbitrum, arbitrumSepolia, chainConfigFromEnv } from "@pasinpay/chain";
import { createDb } from "@pasinpay/db";
import { createPublicClient, http } from "viem";

import { ENV } from "./env.server";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
export const chainConfig = chainConfigFromEnv(ENV);
export const chain = chainConfig.id === 421614 ? arbitrumSepolia : arbitrum;
export const publicClient = createPublicClient({
	chain,
	transport: http(chainConfig.rpcUrl || undefined),
});
