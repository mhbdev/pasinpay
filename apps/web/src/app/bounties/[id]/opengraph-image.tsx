import { ImageResponse } from "next/og";

import { getPublicBounty } from "./get-bounty";

export const alt = "PasinPay bounty";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage({
	params,
}: {
	params: Promise<{ id: string }>;
}) {
	const bounty = await getPublicBounty((await params).id);
	return new ImageResponse(
		<div
			style={{
				background: "#ffffff",
				color: "#111111",
				display: "flex",
				flexDirection: "column",
				fontFamily: "Arial",
				gap: 28,
				padding: 72,
				width: "100%",
				height: "100%",
			}}
		>
			<div style={{ color: "#00843d", display: "flex", fontSize: 32 }}>
				PasinPay
			</div>
			<div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
				<div style={{ display: "flex", fontSize: 58, fontWeight: 700 }}>
					{bounty?.title ?? "Fund verified GitHub work"}
				</div>
				<div style={{ color: "#666666", display: "flex", fontSize: 28 }}>
					{bounty
						? `${bounty.amount} USDG · ${bounty.repository} · Issue #${bounty.issueNumber}`
						: "USDG escrow on Arbitrum"}
				</div>
			</div>
		</div>,
		size,
	);
}
