import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { validGitHubWebhookSignature } from "./github-webhook-signature";

describe("GitHub webhook signatures", () => {
	const body = JSON.stringify({ action: "closed", number: 17 });
	const secret = "test-webhook-secret";
	const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

	test("accepts the exact HMAC signature", () => {
		expect(validGitHubWebhookSignature(body, signature, secret)).toBe(true);
	});

	test("rejects a changed body, secret, or signature format", () => {
		expect(validGitHubWebhookSignature(`${body}!`, signature, secret)).toBe(
			false,
		);
		expect(validGitHubWebhookSignature(body, signature, "wrong-secret")).toBe(
			false,
		);
		expect(
			validGitHubWebhookSignature(
				body,
				signature.replace("sha256=", ""),
				secret,
			),
		).toBe(false);
	});
});
