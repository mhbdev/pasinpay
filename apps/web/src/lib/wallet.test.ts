import { expect, test } from "bun:test";
import { defaultWebChainId, isWebChainConfigured } from "./wallet";

test("the web client only enables its configured backend network", () => {
	const otherChainId = defaultWebChainId === 421614 ? 42161 : 421614;

	expect(isWebChainConfigured(defaultWebChainId)).toBe(true);
	expect(isWebChainConfigured(otherChainId)).toBe(false);
});
