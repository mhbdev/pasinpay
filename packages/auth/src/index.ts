import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Database } from "@pasinpay/db";
import * as schema from "@pasinpay/db/schema/auth";
import { betterAuth } from "better-auth";

export type AuthConfig = {
	BETTER_AUTH_URL: string;
	BETTER_AUTH_SECRET: string;
	CORS_ORIGIN: string;
	NODE_ENV?: string;
	GITHUB_CLIENT_ID?: string;
	GITHUB_CLIENT_SECRET?: string;
};

export function createAuth(
	env: AuthConfig,
	database: Database,
	desktopOrigins: readonly string[] = [],
) {
	return betterAuth({
		database: drizzleAdapter(database, {
			provider: "pg",
			schema,
		}),
		trustedOrigins: [env.CORS_ORIGIN, ...desktopOrigins],
		emailAndPassword: {
			enabled: true,
			autoSignIn: true,
			minPasswordLength: 8,
			maxPasswordLength: 128,
		},
		socialProviders:
			env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
				? {
						github: {
							clientId: env.GITHUB_CLIENT_ID,
							clientSecret: env.GITHUB_CLIENT_SECRET,
						},
					}
				: undefined,
		rateLimit: {
			enabled: true,
			storage: "database",
			window: 10,
			max: 100,
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60, max: 3 },
			},
		},
		account: {
			encryptOAuthTokens: true,
			storeStateStrategy: "cookie",
		},
		secret: env.BETTER_AUTH_SECRET,
		baseURL: env.BETTER_AUTH_URL,
		session: {
			expiresIn: 60 * 60 * 24 * 7,
			updateAge: 60 * 60 * 24,
			freshAge: 60 * 60,
			cookieCache: {
				enabled: true,
				maxAge: 60 * 5,
				strategy: "jwe",
			},
		},
		advanced: {
			useSecureCookies: env.NODE_ENV === "production",
			database: { joins: true },
			ipAddress: {
				ipAddressHeaders: ["x-forwarded-for", "x-real-ip"],
				ipv6Subnet: 64,
			},
			defaultCookieAttributes: {
				sameSite: "lax",
				secure: env.NODE_ENV === "production",
				httpOnly: true,
			},
		},
	});
}

export type Session = ReturnType<typeof createAuth>["$Infer"]["Session"];
