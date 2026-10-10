import { escrowAbi } from "@pasinpay/chain";
import { bounty, x402FundingPayment } from "@pasinpay/db/schema/index";
import {
	decodePaymentSignatureHeader,
	encodePaymentRequiredHeader,
	encodePaymentResponseHeader,
} from "@x402/core/http";
import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import {
	createWalletClient,
	encodeAbiParameters,
	getAddress,
	http,
	isAddress,
	keccak256,
	parseAbiItem,
	stringToHex,
	verifyTypedData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ENV } from "../env.server";
import { chain, chainConfig, db, publicClient } from "../services";

const app = new Hono();
const network = `eip155:${chainConfig.id}`;
const tokenDomain = { name: "Global Dollar", version: "1" } as const;
const fundingTypes = {
	X402Funding: [
		{ name: "bountyId", type: "uint256" },
		{ name: "payer", type: "address" },
		{ name: "rewardAmount", type: "uint128" },
		{ name: "feeAmount", type: "uint128" },
		{ name: "authorizationHash", type: "bytes32" },
		{ name: "intentDeadline", type: "uint64" },
	],
} as const;
const authorizationTypes = {
	TransferWithAuthorization: [
		{ name: "from", type: "address" },
		{ name: "to", type: "address" },
		{ name: "value", type: "uint256" },
		{ name: "validAfter", type: "uint256" },
		{ name: "validBefore", type: "uint256" },
		{ name: "nonce", type: "bytes32" },
	],
} as const;
const x402FundedEvent = parseAbiItem(
	"event X402BountyFunded(uint256 indexed bountyId,address indexed payer,bytes32 indexed authorizationNonce,uint128 totalAmount)",
);

function requiredResponse(url: string, amount: string, error?: string) {
	return {
		x402Version: 2,
		...(error ? { error } : {}),
		resource: {
			url,
			description: "Fund this PasinPay GitHub bounty in USDG escrow.",
			mimeType: "application/json",
		},
		accepts: [
			{
				scheme: "exact",
				network,
				amount,
				asset: chainConfig.usdgAddress,
				payTo: chainConfig.escrowAddress,
				maxTimeoutSeconds: 300,
				extra: {
					assetTransferMethod: "eip3009",
					name: tokenDomain.name,
					version: tokenDomain.version,
				},
			},
		],
	};
}

function fundingIntentExtension(
	bountyId: bigint,
	payer: string,
	rewardAmount: bigint,
	feeAmount: bigint,
) {
	return {
		"pasinpay-funding-intent": {
			domain: {
				name: "PasinPay",
				version: "1",
				chainId: chainConfig.id,
				verifyingContract: chainConfig.escrowAddress,
			},
			primaryType: "X402Funding",
			types: {
				X402Funding: fundingTypes.X402Funding,
			},
			message: {
				bountyId: bountyId.toString(),
				payer: getAddress(payer),
				rewardAmount: rewardAmount.toString(),
				feeAmount: feeAmount.toString(),
				authorizationHash:
					"<keccak256(abi.encode(from,to,value,validAfter,validBefore,nonce))>",
				intentDeadline: "<authorization.validBefore>",
			},
			paymentPayloadField: "payload.fundingIntentSignature",
		},
	};
}

function paymentResponse(
	success: boolean,
	transaction: string,
	payer: string,
	amount: string,
) {
	return {
		success,
		transaction,
		network,
		payer,
		amount,
	};
}

function readPaymentHeader(raw: string) {
	try {
		return decodePaymentSignatureHeader(raw);
	} catch {
		return null;
	}
}

app.get("/bounties/:id/funding", async (c) => {
	const id = c.req.param("id");
	const [row] = await db
		.select({
			id: bounty.id,
			chainId: bounty.chainId,
			amount: bounty.amount,
			creatorWallet: bounty.creatorWallet,
			status: bounty.status,
			onchainBountyId: bounty.onchainBountyId,
		})
		.from(bounty)
		.where(eq(bounty.id, id))
		.limit(1);
	if (row?.status !== "Open" || !row.onchainBountyId) {
		return c.json({ error: "An open on-chain bounty was not found." }, 404);
	}
	const url = new URL(
		`/api/x402/bounties/${row.id}/fund`,
		ENV.BETTER_AUTH_URL,
	).toString();
	if (row.chainId !== 421614 || chainConfig.id !== 421614) {
		return c.json(
			{
				error:
					"x402 bounty funding is currently available on Arbitrum Sepolia only.",
			},
			503,
		);
	}
	if (/^0x0{40}$/i.test(chainConfig.escrowAddress)) {
		return c.json(
			{ error: "The Arbitrum Sepolia escrow is not configured." },
			503,
		);
	}
	try {
		// The adapter is part of the deployed escrow ABI; this read prevents publishing
		// a payment quote against an older contract that would strand direct x402 funds.
		await publicClient.readContract({
			address: chainConfig.escrowAddress,
			abi: escrowAbi,
			functionName: "totalEscrowed",
		});
		const feeBps = await publicClient.readContract({
			address: chainConfig.escrowAddress,
			abi: escrowAbi,
			functionName: "feeBps",
		});
		const feeAmount = (row.amount * BigInt(feeBps)) / 10_000n;
		const requirement = {
			...requiredResponse(url, (row.amount + feeAmount).toString()),
			extensions: fundingIntentExtension(
				row.onchainBountyId,
				row.creatorWallet,
				row.amount,
				feeAmount,
			),
		};
		return c.json(requirement, 402, {
			"Cache-Control": "no-store",
			"PAYMENT-REQUIRED": encodePaymentRequiredHeader(requirement as never),
		});
	} catch {
		return c.json(
			{
				error: "The deployed escrow does not expose the x402 funding adapter.",
			},
			503,
		);
	}
});

app.post("/bounties/:id/fund", async (c) => {
	const id = c.req.param("id");
	const [row] = await db
		.select({
			id: bounty.id,
			chainId: bounty.chainId,
			onchainBountyId: bounty.onchainBountyId,
			amount: bounty.amount,
			creatorWallet: bounty.creatorWallet,
			status: bounty.status,
		})
		.from(bounty)
		.where(eq(bounty.id, id))
		.limit(1);
	if (row?.status !== "Open" || !row.onchainBountyId) {
		return c.json({ error: "An open on-chain bounty was not found." }, 404);
	}
	const url = new URL(
		`/api/x402/bounties/${row.id}/fund`,
		ENV.BETTER_AUTH_URL,
	).toString();
	if (chainConfig.id !== 421614 || row.chainId !== 421614) {
		return c.json(
			{ error: "x402 funding is currently restricted to Arbitrum Sepolia." },
			503,
		);
	}
	if (!ENV.PASINPAY_X402_RELAYER_PRIVATE_KEY) {
		return c.json(
			{
				error:
					"x402 settlement is not enabled: the Sepolia relayer is not configured.",
			},
			503,
		);
	}
	let payment: ReturnType<typeof decodePaymentSignatureHeader> | null = null;
	try {
		const header = c.req.header("PAYMENT-SIGNATURE");
		payment = header ? readPaymentHeader(header) : null;
	} catch {
		payment = null;
	}
	const fallback = async (message: string) => {
		let fallbackFeeBps = Number(ENV.PASINPAY_FEE_BPS);
		try {
			fallbackFeeBps = Number(
				await publicClient.readContract({
					address: chainConfig.escrowAddress,
					abi: escrowAbi,
					functionName: "feeBps",
				}),
			);
		} catch {
			// Use the configured fee only to explain the payment requirements on adapter errors.
		}
		const fallbackAmount =
			row.amount + (row.amount * BigInt(fallbackFeeBps)) / 10_000n;
		const quote = requiredResponse(url, fallbackAmount.toString(), message);
		return c.json(quote, 402, {
			"Cache-Control": "no-store",
			"PAYMENT-REQUIRED": encodePaymentRequiredHeader(quote as never),
		});
	};
	if (!payment)
		return fallback("A valid PAYMENT-SIGNATURE header is required.");
	const accepted = payment.accepted as Record<string, unknown>;
	const payload = payment.payload as Record<string, unknown>;
	const authorization = payload.authorization as
		| Record<string, unknown>
		| undefined;
	const tokenSignature = payload.signature;
	const fundingIntentSignature = payload.fundingIntentSignature;
	if (
		payment.x402Version !== 2 ||
		accepted?.scheme !== "exact" ||
		accepted?.network !== network ||
		accepted?.asset?.toString().toLowerCase() !==
			chainConfig.usdgAddress.toLowerCase() ||
		accepted?.payTo?.toString().toLowerCase() !==
			chainConfig.escrowAddress.toLowerCase() ||
		payment.resource?.url !== url ||
		typeof authorization?.from !== "string" ||
		typeof authorization?.to !== "string" ||
		typeof authorization?.value !== "string" ||
		typeof authorization?.validAfter !== "string" ||
		typeof authorization?.validBefore !== "string" ||
		typeof authorization?.nonce !== "string" ||
		typeof tokenSignature !== "string" ||
		typeof fundingIntentSignature !== "string"
	)
		return fallback(
			"The payment does not match the quoted bounty requirements.",
		);
	if (!isAddress(authorization.from) || !isAddress(authorization.to)) {
		return fallback("The authorization contains an invalid wallet address.");
	}

	let authorizationValue: bigint;
	let validAfter: bigint;
	let validBefore: bigint;
	try {
		authorizationValue = BigInt(authorization.value);
		validAfter = BigInt(authorization.validAfter);
		validBefore = BigInt(authorization.validBefore);
	} catch {
		return fallback("The authorization contains invalid numeric values.");
	}
	const now = BigInt(Math.floor(Date.now() / 1000));
	const amountFromHeader = accepted.amount?.toString();
	const authorizationNonce = authorization.nonce as `0x${string}`;
	let feeBps: number;
	try {
		feeBps = Number(
			await publicClient.readContract({
				address: chainConfig.escrowAddress,
				abi: escrowAbi,
				functionName: "feeBps",
			}),
		);
	} catch {
		return c.json({ error: "The x402 escrow adapter is unavailable." }, 503);
	}
	const feeAmount = (row.amount * BigInt(feeBps)) / 10_000n;
	const totalAmount = row.amount + feeAmount;
	if (
		amountFromHeader !== totalAmount.toString() ||
		authorizationValue !== totalAmount ||
		getAddress(authorization.from) !== getAddress(row.creatorWallet) ||
		getAddress(authorization.to) !== getAddress(chainConfig.escrowAddress) ||
		!/^0x[0-9a-fA-F]{64}$/.test(authorizationNonce) ||
		validAfter > now ||
		validBefore <= now ||
		validBefore - now > 300n
	)
		return fallback(
			"The payer, amount, recipient, or authorization window is invalid.",
		);

	const intentDeadline = validBefore;
	const authorizationHash = keccak256(
		encodeAbiParameters(
			[
				{ type: "address" },
				{ type: "address" },
				{ type: "uint256" },
				{ type: "uint256" },
				{ type: "uint256" },
				{ type: "bytes32" },
			],
			[
				getAddress(authorization.from),
				getAddress(authorization.to),
				authorizationValue,
				validAfter,
				validBefore,
				authorizationNonce,
			],
		),
	);
	const paymentPayloadHash = keccak256(stringToHex(JSON.stringify(payment)));
	try {
		const validAuthorization = await verifyTypedData({
			address: getAddress(row.creatorWallet),
			domain: {
				...tokenDomain,
				chainId: chainConfig.id,
				verifyingContract: chainConfig.usdgAddress,
			},
			types: authorizationTypes,
			primaryType: "TransferWithAuthorization",
			message: {
				from: getAddress(authorization.from),
				to: getAddress(authorization.to),
				value: authorizationValue,
				validAfter,
				validBefore,
				nonce: authorizationNonce,
			},
			signature: tokenSignature as `0x${string}`,
		});
		const validIntent = await verifyTypedData({
			address: getAddress(row.creatorWallet),
			domain: {
				name: "PasinPay",
				version: "1",
				chainId: chainConfig.id,
				verifyingContract: chainConfig.escrowAddress,
			},
			types: fundingTypes,
			primaryType: "X402Funding",
			message: {
				bountyId: row.onchainBountyId,
				payer: getAddress(row.creatorWallet),
				rewardAmount: row.amount,
				feeAmount,
				authorizationHash,
				intentDeadline,
			},
			signature: fundingIntentSignature as `0x${string}`,
		});
		if (!validAuthorization || !validIntent)
			return fallback("One or more payment signatures are invalid.");
	} catch {
		return fallback("The payment signatures could not be verified.");
	}

	const [existing] = await db
		.select()
		.from(x402FundingPayment)
		.where(
			and(
				eq(x402FundingPayment.payerWallet, row.creatorWallet.toLowerCase()),
				eq(
					x402FundingPayment.authorizationNonce,
					authorizationNonce.toLowerCase(),
				),
			),
		)
		.limit(1);
	if (existing?.status === "settled" && existing.transactionHash) {
		return c.json(
			paymentResponse(
				true,
				existing.transactionHash,
				row.creatorWallet,
				totalAmount.toString(),
			),
			200,
			{
				"PAYMENT-RESPONSE": encodePaymentResponseHeader(
					paymentResponse(
						true,
						existing.transactionHash,
						row.creatorWallet,
						totalAmount.toString(),
					) as never,
				),
			},
		);
	}
	if (existing?.status === "pending" && existing.transactionHash) {
		try {
			const receipt = await publicClient.getTransactionReceipt({
				hash: existing.transactionHash as `0x${string}`,
			});
			if (receipt.status === "success") {
				await db
					.update(x402FundingPayment)
					.set({ status: "settled", updatedAt: new Date() })
					.where(eq(x402FundingPayment.id, existing.id));
				await db
					.update(bounty)
					.set({
						status: "Funded",
						feeAmount,
						totalFunded: totalAmount,
						updatedAt: new Date(),
					})
					.where(eq(bounty.id, row.id));
				const result = paymentResponse(
					true,
					existing.transactionHash,
					row.creatorWallet,
					totalAmount.toString(),
				);
				return c.json(result, 200, {
					"PAYMENT-RESPONSE": encodePaymentResponseHeader(result as never),
				});
			}
			await db
				.update(x402FundingPayment)
				.set({
					status: "failed",
					transactionHash: null,
					lastError: "settlement transaction reverted",
					updatedAt: new Date(),
				})
				.where(eq(x402FundingPayment.id, existing.id));
		} catch {
			return c.json(
				{ status: "settlement_pending", transaction: existing.transactionHash },
				202,
			);
		}
	}
	if (existing?.status === "pending" && !existing.transactionHash) {
		// A process can stop after broadcasting a transaction but before persisting its
		// hash. First recover a matching on-chain event; after a short lease, retry the
		// same signed authorization, which the contract protects against replay.
		try {
			const logs = await publicClient.getLogs({
				address: chainConfig.escrowAddress,
				event: x402FundedEvent,
				args: {
					bountyId: row.onchainBountyId,
					payer: getAddress(row.creatorWallet),
					authorizationNonce,
				},
				fromBlock: 0n,
				toBlock: "latest",
			});
			const recovered = logs.at(-1);
			if (recovered?.transactionHash) {
				const recoveredHash = recovered.transactionHash;
				await db
					.update(x402FundingPayment)
					.set({
						status: "settled",
						transactionHash: recoveredHash,
						lastError: null,
						updatedAt: new Date(),
					})
					.where(eq(x402FundingPayment.id, existing.id));
				await db
					.update(bounty)
					.set({
						status: "Funded",
						feeAmount,
						totalFunded: totalAmount,
						updatedAt: new Date(),
					})
					.where(eq(bounty.id, row.id));
				const result = paymentResponse(
					true,
					recoveredHash,
					row.creatorWallet,
					totalAmount.toString(),
				);
				return c.json(result, 200, {
					"PAYMENT-RESPONSE": encodePaymentResponseHeader(result as never),
				});
			}
		} catch {
			return c.json({ status: "settlement_pending" }, 202);
		}
		if (Date.now() - existing.updatedAt.getTime() < 30_000) {
			return c.json({ status: "settlement_pending" }, 202);
		}
		await db
			.update(x402FundingPayment)
			.set({
				status: "failed",
				lastError: "settlement worker lease expired; retrying authorization",
				updatedAt: new Date(),
			})
			.where(eq(x402FundingPayment.id, existing.id));
	}
	if (existing && existing.payloadHash !== paymentPayloadHash) {
		return c.json(
			{
				error:
					"This authorization nonce is already bound to a different payment.",
			},
			409,
		);
	}
	if (!existing) {
		const inserted = await db
			.insert(x402FundingPayment)
			.values({
				bountyId: row.id,
				payerWallet: row.creatorWallet.toLowerCase(),
				authorizationNonce: authorizationNonce.toLowerCase(),
				payloadHash: paymentPayloadHash,
				status: "pending",
			})
			.onConflictDoNothing()
			.returning({ id: x402FundingPayment.id });
		if (inserted.length === 0) {
			return c.json({ status: "settlement_pending" }, 202);
		}
	} else if (existing.status === "failed") {
		await db
			.update(x402FundingPayment)
			.set({
				status: "pending",
				transactionHash: null,
				lastError: null,
				updatedAt: new Date(),
			})
			.where(eq(x402FundingPayment.id, existing.id));
	}

	try {
		const account = privateKeyToAccount(
			ENV.PASINPAY_X402_RELAYER_PRIVATE_KEY as `0x${string}`,
		);
		const walletClient = createWalletClient({
			account,
			chain,
			transport: http(chainConfig.rpcUrl || undefined),
		});
		const transactionHash = await walletClient.writeContract({
			address: chainConfig.escrowAddress,
			abi: escrowAbi,
			functionName: "fundBountyWithX402",
			args: [
				row.onchainBountyId,
				row.amount,
				validAfter,
				validBefore,
				authorizationNonce,
				tokenSignature as `0x${string}`,
				intentDeadline,
				fundingIntentSignature as `0x${string}`,
			],
		});
		await db
			.update(x402FundingPayment)
			.set({
				status: "pending",
				transactionHash,
				lastError: null,
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(x402FundingPayment.payerWallet, row.creatorWallet.toLowerCase()),
					eq(
						x402FundingPayment.authorizationNonce,
						authorizationNonce.toLowerCase(),
					),
				),
			);
		try {
			const receipt = await publicClient.waitForTransactionReceipt({
				hash: transactionHash,
				timeout: 20_000,
			});
			if (receipt.status !== "success")
				throw new Error("Escrow settlement reverted.");
			await db
				.update(x402FundingPayment)
				.set({ status: "settled", updatedAt: new Date() })
				.where(
					and(
						eq(x402FundingPayment.payerWallet, row.creatorWallet.toLowerCase()),
						eq(
							x402FundingPayment.authorizationNonce,
							authorizationNonce.toLowerCase(),
						),
					),
				);
			await db
				.update(bounty)
				.set({
					status: "Funded",
					feeAmount,
					totalFunded: totalAmount,
					updatedAt: new Date(),
				})
				.where(eq(bounty.id, row.id));
			const result = paymentResponse(
				true,
				transactionHash,
				row.creatorWallet,
				totalAmount.toString(),
			);
			return c.json(result, 200, {
				"PAYMENT-RESPONSE": encodePaymentResponseHeader(result as never),
			});
		} catch {
			return c.json(
				{ status: "settlement_pending", transaction: transactionHash },
				202,
			);
		}
	} catch (error) {
		await db
			.update(x402FundingPayment)
			.set({
				status: "failed",
				lastError:
					error instanceof Error
						? error.name.slice(0, 80)
						: "settlement failed",
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(x402FundingPayment.payerWallet, row.creatorWallet.toLowerCase()),
					eq(
						x402FundingPayment.authorizationNonce,
						authorizationNonce.toLowerCase(),
					),
				),
			);
		return c.json(
			{
				error:
					"x402 escrow settlement failed; the payment authorization remains retryable.",
			},
			502,
		);
	}
});

export const x402Routes = app;
