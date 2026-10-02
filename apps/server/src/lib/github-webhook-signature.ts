import { createHmac, timingSafeEqual } from "node:crypto";

export function validGitHubWebhookSignature(
	body: string,
	signature: string | undefined,
	secret: string,
) {
	if (!signature?.startsWith("sha256=")) return false;
	const expected = Buffer.from(
		`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`,
	);
	const received = Buffer.from(signature);
	return (
		expected.length === received.length && timingSafeEqual(expected, received)
	);
}
