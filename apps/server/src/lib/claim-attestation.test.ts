import { describe, expect, test } from "bun:test";
import {
	getAttestationExpiry,
	isAttestationExpired,
} from "./claim-attestation";

describe("claim attestation lifetime", () => {
	test("keeps the expiry within the bounty deadline", () => {
		const now = new Date("2026-10-04T16:00:00.000Z");
		const deadline = new Date("2026-10-10T15:32:00.000Z");

		expect(getAttestationExpiry(deadline, now)).toEqual(
			new Date("2026-10-04T17:00:00.000Z"),
		);
	});

	test("returns an expiry that can be refreshed after it becomes stale", () => {
		const expired = new Date("2026-10-04T16:10:49.000Z");
		const now = new Date("2026-10-04T16:15:24.000Z");

		expect(isAttestationExpired(expired, now)).toBe(true);
		expect(
			getAttestationExpiry(new Date("2026-10-10T15:32:00.000Z"), now),
		).toEqual(new Date("2026-10-04T17:15:24.000Z"));
	});

	test("fails closed when the bounty deadline has passed", () => {
		expect(() =>
			getAttestationExpiry(
				new Date("2026-10-04T16:14:00.000Z"),
				new Date("2026-10-04T16:15:24.000Z"),
			),
		).toThrow("No time remains for an attestation");
	});
});
