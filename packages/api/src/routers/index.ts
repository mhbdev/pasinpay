import { protectedProcedure, publicProcedure, router } from "../index";
import { apiKeyRouter } from "./api-keys";
import { bountyRouter } from "./bounties";

export const appRouter = router({
	healthCheck: publicProcedure.query(() => {
		return "OK";
	}),
	privateData: protectedProcedure.query(({ ctx }) => {
		return {
			message: "This is private",
			user: ctx.session.user,
		};
	}),
	bounties: bountyRouter,
	apiKeys: apiKeyRouter,
});
export type AppRouter = typeof appRouter;
