"use client";

import { Toaster } from "@pasinpay/ui/components/sonner";
import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { WagmiProvider } from "wagmi";
import { walletConfig } from "@/lib/wallet";
import { queryClient } from "@/utils/trpc";
import { NetworkProvider } from "./network-provider";
import { ThemeProvider } from "./theme-provider";

export default function Providers({ children }: { children: React.ReactNode }) {
	return (
		<ThemeProvider
			attribute="class"
			defaultTheme="light"
			enableSystem={false}
			disableTransitionOnChange
		>
			<WagmiProvider config={walletConfig}>
				<QueryClientProvider client={queryClient}>
					<NetworkProvider>
						{children}
						<ReactQueryDevtools />
					</NetworkProvider>
				</QueryClientProvider>
			</WagmiProvider>
			<Toaster richColors />
		</ThemeProvider>
	);
}
