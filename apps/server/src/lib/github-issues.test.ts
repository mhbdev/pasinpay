import { describe, expect, test } from "bun:test";
import { normalizeGitHubIssues } from "./github";

const issue = {
	number: 17,
	title: "Ship it",
	body: null,
	html_url: "https://github.com/mhbdev/pasinpay/issues/17",
	updated_at: "2026-10-03T00:00:00Z",
};

describe("GitHub issue response normalization", () => {
	test("accepts GitHub's array response", () => {
		expect(normalizeGitHubIssues([issue])).toEqual([issue]);
	});

	test("accepts legacy item-wrapped responses", () => {
		expect(normalizeGitHubIssues({ items: [issue] })).toEqual([issue]);
	});

	test("returns an empty list for malformed responses", () => {
		expect(normalizeGitHubIssues({ items: undefined })).toEqual([]);
		expect(normalizeGitHubIssues(null)).toEqual([]);
	});
});
