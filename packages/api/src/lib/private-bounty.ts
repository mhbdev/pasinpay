import {
	createHmac,
	randomBytes,
	scrypt as scryptCallback,
	timingSafeEqual,
} from "node:crypto";

const PASSWORD_KEY_LENGTH = 64;
const ACCESS_TOKEN_LIFETIME_SECONDS = 15 * 60;

function derivePasswordKey(password: string, salt: string) {
	return new Promise<Buffer>((resolve, reject) => {
		scryptCallback(
			password,
			salt,
			PASSWORD_KEY_LENGTH,
			{ N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
			(error, derivedKey) => {
				if (error) reject(error);
				else resolve(derivedKey as Buffer);
			},
		);
	});
}

export const joiningPasswordSchemaMessage =
	"Joining passwords must be between 12 and 128 characters.";

export async function hashJoiningPassword(password: string) {
	const salt = randomBytes(16).toString("base64url");
	const derivedKey = await derivePasswordKey(password, salt);
	return { salt, hash: derivedKey.toString("base64url") };
}

export async function verifyJoiningPassword(
	password: string,
	salt: string,
	expectedHash: string,
) {
	try {
		const expected = Buffer.from(expectedHash, "base64url");
		const actual = await derivePasswordKey(password, salt);
		return (
			expected.length === actual.length && timingSafeEqual(expected, actual)
		);
	} catch {
		return false;
	}
}

type BountyAccessClaims = {
	bountyId: string;
	userId: string;
	expiresAt: number;
};

function signPayload(payload: string, secret: string) {
	return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createBountyAccessToken(
	secret: string,
	userId: string,
	bountyId: string,
	issuedAt = Math.floor(Date.now() / 1000),
) {
	const payload = Buffer.from(
		JSON.stringify({
			userId,
			bountyId,
			expiresAt: issuedAt + ACCESS_TOKEN_LIFETIME_SECONDS,
		} satisfies BountyAccessClaims),
	).toString("base64url");
	return `${payload}.${signPayload(payload, secret)}`;
}

export function verifyBountyAccessToken(
	token: string | undefined,
	secret: string,
	userId: string,
	bountyId: string,
	now = Math.floor(Date.now() / 1000),
) {
	if (!token) return false;
	const [payload, signature, extra] = token.split(".");
	if (!payload || !signature || extra !== undefined) return false;
	const expectedSignature = Buffer.from(signPayload(payload, secret));
	const actualSignature = Buffer.from(signature);
	if (
		expectedSignature.length !== actualSignature.length ||
		!timingSafeEqual(expectedSignature, actualSignature)
	)
		return false;
	try {
		const claims = JSON.parse(
			Buffer.from(payload, "base64url").toString("utf8"),
		) as Partial<BountyAccessClaims>;
		return (
			claims.userId === userId &&
			claims.bountyId === bountyId &&
			typeof claims.expiresAt === "number" &&
			claims.expiresAt > now
		);
	} catch {
		return false;
	}
}
