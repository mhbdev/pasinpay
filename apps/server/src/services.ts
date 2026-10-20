import { createAuth } from "@pasinpay/auth";
import {
	ARBITRUM_SEPOLIA_ID,
	ARC_TESTNET_ID,
	chainConfigFromEnvForChain,
	chains,
	SUPPORTED_CHAIN_IDS,
	ZERO_ADDRESS,
} from "@pasinpay/chain";
import { createDb } from "@pasinpay/db";
import { solanaDevnetConfigFromEnv } from "@pasinpay/solana";
import { createPublicClient, http, type PublicClient } from "viem";

import { ENV } from "./env.server";
import {
	createIssue,
	getRepositoryPrivacy,
	linkIssue,
	listAppInstallations,
	listInstallationRepositories,
	listRepositoryIssues,
	listRepositoryPullRequests,
} from "./lib/github";

export const db = createDb(ENV);
export const auth = createAuth(ENV, db);
export const solanaDevnetConfig = solanaDevnetConfigFromEnv(ENV);
export const configuredSolanaDevnetConfig =
	solanaDevnetConfig.programId && solanaDevnetConfig.feeTreasury
		? solanaDevnetConfig
		: null;

export type ChainRuntime = {
	config: ReturnType<typeof chainConfigFromEnvForChain>;
	chain: (typeof chains)[keyof typeof chains];
	publicClient: PublicClient;
	attestorPrivateKey: string;
	relayerPrivateKey: string;
	deploymentBlock: bigint;
};

function chainSecret(id: number, kind: "attestor" | "relayer") {
	if (id === ARBITRUM_SEPOLIA_ID) {
		return kind === "attestor"
			? ENV.PASINPAY_ARBITRUM_SEPOLIA_ATTESTOR_PRIVATE_KEY
			: ENV.PASINPAY_ARBITRUM_SEPOLIA_X402_RELAYER_PRIVATE_KEY;
	}
	if (id === ARC_TESTNET_ID) {
		return kind === "attestor"
			? ENV.PASINPAY_ARC_TESTNET_ATTESTOR_PRIVATE_KEY
			: ENV.PASINPAY_ARC_TESTNET_X402_RELAYER_PRIVATE_KEY;
	}
	return "";
}

function deploymentBlock(id: number) {
	if (id === ARBITRUM_SEPOLIA_ID)
		return BigInt(ENV.PASINPAY_ARBITRUM_SEPOLIA_DEPLOYMENT_BLOCK);
	if (id === ARC_TESTNET_ID)
		return BigInt(ENV.PASINPAY_ARC_TESTNET_DEPLOYMENT_BLOCK);
	return BigInt(0);
}

function createRuntime(id: (typeof SUPPORTED_CHAIN_IDS)[number]): ChainRuntime {
	const config = chainConfigFromEnvForChain(ENV, id);
	const chain = chains[id as keyof typeof chains];
	if (!chain) throw new Error(`No viem chain definition for ${id}`);
	return {
		config,
		chain,
		publicClient: createPublicClient({
			chain,
			transport: http(config.rpcUrl || undefined),
		}),
		attestorPrivateKey: chainSecret(id, "attestor"),
		relayerPrivateKey: chainSecret(id, "relayer"),
		deploymentBlock: deploymentBlock(id),
	};
}

export const chainRuntimes = Object.fromEntries(
	SUPPORTED_CHAIN_IDS.map((id) => [id, createRuntime(id)]),
) as Record<(typeof SUPPORTED_CHAIN_IDS)[number], ChainRuntime>;

export const configuredChainRuntimes = Object.fromEntries(
	Object.entries(chainRuntimes).filter(
		([, runtime]) =>
			runtime.config.escrowAddress.toLowerCase() !== ZERO_ADDRESS,
	),
) as Partial<Record<(typeof SUPPORTED_CHAIN_IDS)[number], ChainRuntime>>;

export function getChainRuntime(chainId: number) {
	const runtime = chainRuntimes[chainId as keyof typeof chainRuntimes];
	if (!runtime || runtime.config.escrowAddress.toLowerCase() === ZERO_ADDRESS) {
		throw new Error(`Network ${chainId} is not configured for PasinPay`);
	}
	return runtime;
}

export const defaultRuntime = getChainRuntime(Number(ENV.PASINPAY_CHAIN_ID));
export const chainConfig = defaultRuntime.config;
export const chain = defaultRuntime.chain;
export const publicClient = defaultRuntime.publicClient;

export const githubService = {
	appSlug: ENV.GITHUB_APP_SLUG,
	listAppInstallations,
	listInstallationRepositories,
	listRepositoryIssues,
	getRepositoryPrivacy,
	listRepositoryPullRequests,
	createIssue,
	linkIssue,
};
