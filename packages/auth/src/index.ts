import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { mcp } from "@better-auth/mcp";
import type { Database } from "@pasinpay/db";
import * as schema from "@pasinpay/db/schema/auth";
import { betterAuth } from "better-auth";
import { jwt } from "better-auth/plugins";

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
		plugins: [
			jwt(),
			mcp({
				loginPage: "/login",
				consentPage: "/mcp/consent",
				allowPublicClientPrelogin: true,
				resource: new URL("/mcp", env.BETTER_AUTH_URL).toString(),
				scopes: ["bounties:read", "bounties:write"],
			}),
			cimd({
				fetchClientMetadataResource,
				metadataProfile: "mcp-2026-07-28",
			}),
		],
		socialProviders:
			env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET
				? {
						github: {
							clientId: env.GITHUB_CLIENT_ID,
							clientSecret: env.GITHUB_CLIENT_SECRET,
							scope: ["read:user", "user:email"],
							mapProfileToUser: (profile) => ({
								// GitHub may keep the primary address private even when the
								// account is verified. Use GitHub's stable id as a local,
								// non-routable identity fallback in that case.
								email:
									profile.email ??
									`github-${profile.id}@users.noreply.pasinpay.app`,
								name: profile.name ?? profile.login,
								image: profile.avatar_url,
								emailVerified: true,
							}),
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
