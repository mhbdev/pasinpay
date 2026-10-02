import { trpcServer } from "@hono/trpc-server";
import { appRouter } from "@pasinpay/api/routers/index";
import { sql } from "drizzle-orm";
import { initLogger } from "evlog";
import {
	type BetterAuthInstance,
	createAuthMiddleware,
} from "evlog/better-auth";
import { createFsDrain } from "evlog/fs";
import { type EvlogVariables, evlog } from "evlog/hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createContext } from "./context";
import { ENV } from "./env.server";
import { githubWebhook } from "./routes/github-webhook";
import { auth, db, publicClient } from "./services";

initLogger({
	env: { service: "pasinpay-server" },
});

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
	exclude: [
		"/api/auth/**",
		"/api/github/webhook",
		"/api/health",
		"/api/readiness",
	],
	maskEmail: true,
});

const app = new Hono<EvlogVariables>();

app.use(
	evlog({
		drain: process.env.NODE_ENV === "production" ? undefined : createFsDrain(),
	}),
);
app.use("*", async (c, next) => {
	await identifyUser(c.get("log"), c.req.raw.headers, c.req.path);
	await next();
});

app.use(
	"/*",
	cors({
		origin: ENV.CORS_ORIGIN,
		allowMethods: ["GET", "POST", "OPTIONS"],
		allowHeaders: ["Content-Type", "Authorization"],
		credentials: true,
	}),
);

app.on(["POST", "GET"], "/api/auth/*", async (c) => auth.handler(c.req.raw));
app.route("/api/github/webhook", githubWebhook);

app.get("/api/health", (c) => c.json({ ok: true, service: "pasinpay-server" }));
app.get("/api/readiness", async (c) => {
	try {
		await db.execute(sql`select 1`);
		await publicClient.getChainId();
		return c.json({ ok: true, database: true, chain: true });
	} catch (error) {
		return c.json(
			{
				ok: false,
				error: error instanceof Error ? error.message : "not ready",
			},
			503,
		);
	}
});

app.use(
	"/trpc/*",
	trpcServer({
		endpoint: "/trpc",
		router: appRouter,
		createContext: (_opts, context) => {
			return createContext({ context });
		},
	}),
);

app.get("/", (c) => {
	return c.text("OK");
});

export default app;
