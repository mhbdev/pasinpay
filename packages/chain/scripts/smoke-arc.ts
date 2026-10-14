import { createPublicClient, hashDomain, http } from "viem";
import {
	ARBITRUM_SEPOLIA_ID,
	ARC_TESTNET_ID,
	chainConfigs,
	chains,
	erc20MetadataAbi,
	SUPPORTED_CHAIN_IDS,
	supportsX402Funding,
} from "../src/config";
import { getEip1559FeeQuote } from "../src/fees";

const authorizationStateAbi = [
	{
		type: "function",
		name: "authorizationState",
		stateMutability: "view",
		inputs: [
			{ name: "authorizer", type: "address" },
			{ name: "nonce", type: "bytes32" },
		],
		outputs: [{ name: "", type: "bool" }],
	},
] as const;

const domainSeparatorAbi = [
	{
		type: "function",
		name: "DOMAIN_SEPARATOR",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "bytes32" }],
	},
] as const;

const versionAbi = [
	{
		type: "function",
		name: "version",
		stateMutability: "view",
		inputs: [],
		outputs: [{ name: "", type: "string" }],
	},
] as const;

const zeroAddress = "0x0000000000000000000000000000000000000000";
const zeroNonce = `0x${"0".repeat(64)}` as `0x${string}`;
const networks = SUPPORTED_CHAIN_IDS.map((id) => ({
	id,
	config: chainConfigs[id],
}));

for (const { id, config } of networks) {
	const client = createPublicClient({
		chain: chains[id],
		transport: http(config.rpcUrl),
	});
	const actualChainId = await client.getChainId();
	if (actualChainId !== id) {
		throw new Error(`${config.name}: RPC returned chain ID ${actualChainId}`);
	}

	const [bytecode, symbol, decimals, name] = await Promise.all([
		client.getBytecode({ address: config.tokenAddress }),
		client.readContract({
			address: config.tokenAddress,
			abi: erc20MetadataAbi,
			functionName: "symbol",
		}),
		client.readContract({
			address: config.tokenAddress,
			abi: erc20MetadataAbi,
			functionName: "decimals",
		}),
		client.readContract({
			address: config.tokenAddress,
			abi: erc20MetadataAbi,
			functionName: "name",
		}),
	]);
	if (!bytecode || bytecode === "0x") {
		throw new Error(`${config.name}: token contract has no deployed bytecode`);
	}
	if (
		symbol !== config.tokenSymbol ||
		decimals !== 6 ||
		name !== config.tokenEip712Name
	) {
		throw new Error(
			`${config.name}: unexpected token metadata (${name}, ${symbol}, ${decimals})`,
		);
	}

	let integrationChecks = "token contract and metadata verified";
	if (id === 5042 || id === 5042002) {
		const [version, authorizationState, domainSeparator] = await Promise.all([
			client.readContract({
				address: config.tokenAddress,
				abi: versionAbi,
				functionName: "version",
			}),
			client.readContract({
				address: config.tokenAddress,
				abi: authorizationStateAbi,
				functionName: "authorizationState",
				args: [zeroAddress, zeroNonce],
			}),
			client.readContract({
				address: config.tokenAddress,
				abi: domainSeparatorAbi,
				functionName: "DOMAIN_SEPARATOR",
			}),
		]);
		const expectedDomain = hashDomain({
			types: {
				EIP712Domain: [
					{ name: "name", type: "string" },
					{ name: "version", type: "string" },
					{ name: "chainId", type: "uint256" },
					{ name: "verifyingContract", type: "address" },
				],
			},
			domain: {
				name: config.tokenEip712Name,
				version: config.tokenEip712Version,
				chainId: config.id,
				verifyingContract: config.tokenAddress,
			},
		});
		if (
			version !== config.tokenEip712Version ||
			typeof authorizationState !== "boolean" ||
			domainSeparator !== expectedDomain
		) {
			throw new Error(
				`${config.name}: EIP-3009 domain or interface check failed`,
			);
		}
		const [latestBlock, feeEstimate] = await Promise.all([
			client.getBlock({ blockTag: "latest" }),
			client.estimateFeesPerGas(),
		]);
		const feeQuote = getEip1559FeeQuote(
			id,
			latestBlock.baseFeePerGas ?? feeEstimate.maxFeePerGas ?? 0n,
			feeEstimate,
		);
		if (feeQuote.maxFeePerGas < 20_000_000_000n) {
			throw new Error(`${config.name}: fee quote is below Arc's 20 Gwei floor`);
		}
		integrationChecks += "; EIP-3009 and EIP-712 domain verified";
		integrationChecks += "; live fee quote meets 20 Gwei floor";
	}
	if (
		(id === ARBITRUM_SEPOLIA_ID || id === ARC_TESTNET_ID) &&
		!(await supportsX402Funding(client, config))
	) {
		throw new Error(
			`${config.name}: deployed x402 funding adapter is unavailable`,
		);
	}
	if (id === ARBITRUM_SEPOLIA_ID || id === ARC_TESTNET_ID) {
		integrationChecks += "; deployed x402 escrow/token adapter verified";
	}

	console.log(
		`${config.name}: RPC chain ${actualChainId}; ${symbol}/${decimals}; ${integrationChecks}`,
	);
}
