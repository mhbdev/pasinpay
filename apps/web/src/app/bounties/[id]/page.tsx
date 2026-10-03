import type { Metadata } from "next";

import BountyDetailClient from "./bounty-detail";
import { getPublicBounty } from "./get-bounty";

type PageProps = { params: Promise<{ id: string }> };

export async function generateMetadata({
	params,
}: PageProps): Promise<Metadata> {
	const { id } = await params;
	const bounty = await getPublicBounty(id);
	const title = bounty ? `${bounty.title} · PasinPay` : "Bounty · PasinPay";
	const description = bounty
		? `A ${bounty.amount} USDG bounty for ${bounty.repository} issue #${bounty.issueNumber}.`
		: "Fund verified GitHub work with USDG on Arbitrum.";
	const url = `/bounties/${id}`;

	return {
		title,
		description,
		alternates: { canonical: url },
		openGraph: {
			type: "article",
			url,
			title,
			description,
			images: [{ url: `${url}/opengraph-image`, width: 1200, height: 630 }],
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			images: [`${url}/opengraph-image`],
		},
	};
}

export default function BountyDetailPage() {
	return <BountyDetailClient />;
}
