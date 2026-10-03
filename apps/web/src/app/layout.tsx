import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";

import "../index.css";
import { cn } from "@pasinpay/ui/lib/utils";
import Header from "@/components/header";
import Providers from "@/components/providers";
import PwaRegistration from "@/components/pwa-registration";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = Geist({
	variable: "--font-geist-sans",
	subsets: ["latin"],
});

const geistMono = Geist_Mono({
	variable: "--font-geist-mono",
	subsets: ["latin"],
});

export const metadata: Metadata = {
	title: "PasinPay — Pay for shipped code, automatically.",
	description:
		"Fund GitHub work in USDG. Settle verified merged pull requests on Arbitrum.",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html
			lang="en"
			suppressHydrationWarning
			className={cn("font-sans", inter.variable)}
		>
			<body
				className={`${geistSans.variable} ${geistMono.variable} antialiased`}
			>
				<PwaRegistration />

				<Providers>
					<div className="min-h-svh">
						<Header />
						{children}
					</div>
				</Providers>
			</body>
		</html>
	);
}
