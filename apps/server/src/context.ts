import type { Context as ApiContext } from "@pasinpay/api/context";
import type { Context as HonoContext } from "hono";

import { ENV } from "./env.server";
import {
	auth,
	chainConfig,
	chainRuntimes,
	configuredSolanaDevnetConfig,
	db,
	githubService,
} from "./services";

export type CreateContextOptions = {
	context: HonoContext;
};

export async function createContext({
	context,
}: CreateContextOptions): Promise<ApiContext> {
	const session = await auth.api.getSession({
		headers: context.req.raw.headers,
	});
	return {
		db,
		session,
		github: githubService,
		chain: chainConfig,
		chains: Object.fromEntries(
			Object.entries(chainRuntimes)
				.filter(
					([, runtime]) =>
						runtime.config.escrowAddress.toLowerCase() !==
						"0x0000000000000000000000000000000000000000",
				)
				.map(([id, runtime]) => [Number(id), runtime.config]),
		),
		solana: configuredSolanaDevnetConfig,
		accessTokenSecret: ENV.BETTER_AUTH_SECRET,
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
