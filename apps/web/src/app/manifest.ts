import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
	return {
		name: "PasinPay",
		short_name: "PasinPay",
		description: "Pay for shipped GitHub code automatically in USDG.",
		start_url: "/",
		display: "standalone",
		background_color: "#f8fafc",
		theme_color: "#111318",
		icons: [
			{
				src: "/brand/pasinpay-mark.png",
				sizes: "192x192",
				type: "image/png",
			},
			{
				src: "/brand/pasinpay-mark.png",
				sizes: "512x512",
				type: "image/png",
			},
		],
	};
}
