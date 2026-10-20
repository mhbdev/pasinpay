"use client";

import type { ChainConfig } from "@pasinpay/chain";
import { SUPPORTED_CHAIN_IDS } from "@pasinpay/chain";
import { SOLANA_DEVNET_ID } from "@pasinpay/solana";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { getReadableError } from "@/lib/errors";
import { isSolanaDevnetConfigured } from "@/lib/solana-client";
import {
	defaultWebChainId,
	isWebChainConfigured,
	type WebChainId,
	webChainConfigs,
} from "@/lib/wallet";

const storageKey = "pasinpay.network";

type NetworkContextValue = {
	chainId: WebChainId;
	networkId: number;
	chainConfig: ChainConfig;
	ready: boolean;
	switching: boolean;
	error: string | null;
	selectNetwork: (chainId: number) => Promise<void>;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

function isWebChainId(value: number): value is WebChainId {
	return SUPPORTED_CHAIN_IDS.includes(value as WebChainId);
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
	const [chainId, setChainId] = useState<WebChainId>(defaultWebChainId);
	const [networkId, setNetworkId] = useState<number>(defaultWebChainId);
	const [ready, setReady] = useState(false);
	const [switching, setSwitching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { chainId: walletChainId, isConnected } = useAccount();
	const { switchChainAsync } = useSwitchChain();

	useEffect(() => {
		const stored = Number(window.localStorage.getItem(storageKey));
		if (stored === SOLANA_DEVNET_ID && isSolanaDevnetConfigured()) {
			setNetworkId(SOLANA_DEVNET_ID);
			setChainId(defaultWebChainId);
		} else if (isWebChainId(stored) && isWebChainConfigured(stored)) {
			setChainId(stored);
			setNetworkId(stored);
		} else {
			setChainId(defaultWebChainId);
			setNetworkId(defaultWebChainId);
			window.localStorage.setItem(storageKey, String(defaultWebChainId));
		}
		setReady(true);
	}, []);

	const selectNetwork = useCallback(
		async (nextChainId: number) => {
			if (nextChainId === SOLANA_DEVNET_ID) {
				if (!isSolanaDevnetConfigured()) {
					setError("Solana Devnet escrow is not deployed and configured yet.");
					return;
				}
				setError(null);
				setNetworkId(SOLANA_DEVNET_ID);
				window.localStorage.setItem(storageKey, String(SOLANA_DEVNET_ID));
				return;
			}
			if (!isWebChainId(nextChainId)) return;
			if (!isWebChainConfigured(nextChainId)) {
				setError("This network is not enabled for PasinPay yet.");
				return;
			}
			const previousChainId = chainId;
			setError(null);
			setChainId(nextChainId);
			setNetworkId(nextChainId);
			window.localStorage.setItem(storageKey, String(nextChainId));
			if (!isConnected || walletChainId === nextChainId) return;

			setSwitching(true);
			try {
				await switchChainAsync({ chainId: nextChainId });
			} catch (cause) {
				setChainId(previousChainId);
				setNetworkId(previousChainId);
				window.localStorage.setItem(storageKey, String(previousChainId));
				setError(
					getReadableError(cause, "The wallet network switch was rejected."),
				);
			} finally {
				setSwitching(false);
			}
		},
		[chainId, isConnected, switchChainAsync, walletChainId],
	);

	const value = useMemo(
		() => ({
			chainId,
			networkId,
			chainConfig: webChainConfigs[chainId],
			ready,
			switching,
			error,
			selectNetwork,
		}),
		[chainId, error, networkId, ready, selectNetwork, switching],
	);

	return (
		<NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
	);
}

export function useAppNetwork() {
	const context = useContext(NetworkContext);
	if (!context)
		throw new Error("useAppNetwork must be used inside NetworkProvider");
	return context;
}
