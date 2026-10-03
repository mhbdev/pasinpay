import type { Context as ApiContext } from "@pasinpay/api/context";
import type { Context as HonoContext } from "hono";

import { auth, chainConfig, db, githubService } from "./services";

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
	};
}

export type Context = Awaited<ReturnType<typeof createContext>>;
