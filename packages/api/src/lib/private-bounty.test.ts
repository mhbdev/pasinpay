import { describe, expect, test } from "bun:test";
import {
	createBountyAccessToken,
	hashJoiningPassword,
	verifyBountyAccessToken,
	verifyJoiningPassword,
} from "./private-bounty";

describe("private bounty access", () => {
	test("stores a salted password hash and verifies it without leaking plaintext", async () => {
		const password = "a long joining password";
		const first = await hashJoiningPassword(password);
		const second = await hashJoiningPassword(password);

		expect(first.salt).not.toBe(second.salt);
		expect(first.hash).not.toBe(password);
		expect(first.hash).not.toBe(second.hash);
		expect(await verifyJoiningPassword(password, first.salt, first.hash)).toBe(
			true,
		);
		expect(
			await verifyJoiningPassword("incorrect password", first.salt, first.hash),
		).toBe(false);
	});

	test("scopes short-lived access tokens to one user and bounty", () => {
		const token = createBountyAccessToken(
			"test-secret",
			"user-1",
			"bounty-1",
			100,
		);

		expect(
			verifyBountyAccessToken(token, "test-secret", "user-1", "bounty-1", 101),
		).toBe(true);
		expect(
			verifyBountyAccessToken(token, "test-secret", "user-2", "bounty-1", 101),
		).toBe(false);
		expect(
			verifyBountyAccessToken(token, "test-secret", "user-1", "bounty-2", 101),
		).toBe(false);
		expect(
			verifyBountyAccessToken(token, "wrong-secret", "user-1", "bounty-1", 101),
		).toBe(false);
		expect(
			verifyBountyAccessToken(
				token,
				"test-secret",
				"user-1",
				"bounty-1",
				1_000,
			),
		).toBe(false);
	});
});
