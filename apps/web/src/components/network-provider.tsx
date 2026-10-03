"use client";

import type { ChainConfig } from "@pasinpay/chain";
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { useAccount, useSwitchChain } from "wagmi";
import {
	defaultWebChainId,
	type WebChainId,
	webChainConfigs,
} from "@/lib/wallet";

const storageKey = "pasinpay.network";

type NetworkContextValue = {
	chainId: WebChainId;
	chainConfig: ChainConfig;
	ready: boolean;
	switching: boolean;
	error: string | null;
	selectNetwork: (chainId: WebChainId) => Promise<void>;
};

const NetworkContext = createContext<NetworkContextValue | null>(null);

function isWebChainId(value: number): value is WebChainId {
	return value === 421614 || value === 42161;
}

export function NetworkProvider({ children }: { children: React.ReactNode }) {
	const [chainId, setChainId] = useState<WebChainId>(defaultWebChainId);
	const [ready, setReady] = useState(false);
	const [switching, setSwitching] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const { chainId: walletChainId, isConnected } = useAccount();
	const { switchChainAsync } = useSwitchChain();

	useEffect(() => {
		const stored = Number(window.localStorage.getItem(storageKey));
		if (isWebChainId(stored)) setChainId(stored);
		setReady(true);
	}, []);

	const selectNetwork = useCallback(
		async (nextChainId: WebChainId) => {
			const previousChainId = chainId;
			setError(null);
			setChainId(nextChainId);
			window.localStorage.setItem(storageKey, String(nextChainId));
			if (!isConnected || walletChainId === nextChainId) return;

			setSwitching(true);
			try {
				await switchChainAsync({ chainId: nextChainId });
			} catch {
				setChainId(previousChainId);
				window.localStorage.setItem(storageKey, String(previousChainId));
				setError("The wallet network switch was rejected.");
			} finally {
				setSwitching(false);
			}
		},
		[chainId, isConnected, switchChainAsync, walletChainId],
	);

	const value = useMemo(
		() => ({
			chainId,
			chainConfig: webChainConfigs[chainId],
			ready,
			switching,
			error,
			selectNetwork,
		}),
		[chainId, error, ready, selectNetwork, switching],
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
