export type PublicBounty = {
	title: string;
	repository: string;
	amount: string;
	feeAmount: string;
	totalFunded: string;
	status: string;
	issueNumber: number;
	issueTitle: string;
	issueUrl: string;
};

export async function getPublicBounty(id: string) {
	const serverUrl = (
		process.env.SERVER_URL ??
		process.env.NEXT_PUBLIC_SERVER_URL ??
		"https://pasinpay-api.upstand.dev"
	).replace(/\/$/, "");
	const input = encodeURIComponent(JSON.stringify({ id }));
	try {
		const response = await fetch(
			`${serverUrl}/trpc/bounties.getById?input=${input}`,
			{
				next: { revalidate: 60, tags: [`bounty:${id}`] },
			},
		);
		if (!response.ok) return null;
		const payload = (await response.json()) as {
			result?: { data?: PublicBounty | null };
		};
		return payload.result?.data ?? null;
	} catch {
		return null;
	}
}
