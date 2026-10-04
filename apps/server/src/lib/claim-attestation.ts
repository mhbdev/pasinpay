export function getAttestationExpiry(deadline: Date, now = new Date()): Date {
	const nowSeconds = Math.floor(now.getTime() / 1000);
	const expiresAt = Math.min(
		Math.floor(deadline.getTime() / 1000) - 30,
		nowSeconds + 3600,
	);
	if (expiresAt <= nowSeconds) {
		throw new Error("No time remains for an attestation");
	}
	return new Date(expiresAt * 1000);
}

export function isAttestationExpired(
	expiresAt: Date,
	now = new Date(),
): boolean {
	return expiresAt.getTime() <= now.getTime();
}
