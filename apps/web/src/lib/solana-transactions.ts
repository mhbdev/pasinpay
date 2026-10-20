import { SOLANA_DEVNET_RPC_URL } from "@pasinpay/solana";
import {
	type Address,
	appendTransactionMessageInstructions,
	createSolanaRpc,
	createTransactionMessage,
	getBase64EncodedWireTransaction,
	getSignatureFromTransaction,
	type Instruction,
	setTransactionMessageFeePayerSigner,
	setTransactionMessageLifetimeUsingBlockhash,
	signTransactionMessageWithSigners,
	type TransactionSigner,
} from "@solana/kit";

export function createDevnetRpc() {
	const url =
		process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC_URL || SOLANA_DEVNET_RPC_URL;
	return { rpc: createSolanaRpc(url) };
}

export async function sendSolanaInstructions(input: {
	feePayer: TransactionSigner<Address>;
	instructions: readonly Instruction[];
}) {
	const { rpc } = createDevnetRpc();
	const lifetime = await rpc
		.getLatestBlockhash({ commitment: "confirmed" })
		.send();
	const message = appendTransactionMessageInstructions(
		input.instructions,
		setTransactionMessageLifetimeUsingBlockhash(
			lifetime.value,
			setTransactionMessageFeePayerSigner(
				input.feePayer,
				createTransactionMessage({ version: 0 }),
			),
		),
	);
	const signed = await signTransactionMessageWithSigners(message);
	const expectedSignature = getSignatureFromTransaction(signed);
	const encodedTransaction = getBase64EncodedWireTransaction(signed);
	const signature = await rpc
		.sendTransaction(encodedTransaction, {
			encoding: "base64",
			preflightCommitment: "confirmed",
			maxRetries: BigInt(3),
		})
		.send();
	if (signature !== expectedSignature)
		throw new Error(
			"The RPC returned a different signature for the signed transaction.",
		);
	const deadline = Date.now() + 60_000;
	while (Date.now() < deadline) {
		const statuses = await rpc
			.getSignatureStatuses([signature], { searchTransactionHistory: true })
			.send();
		const status = statuses.value[0];
		if (status?.err)
			throw new Error(
				`Solana transaction failed on chain: ${JSON.stringify(status.err)}`,
			);
		if (
			status?.confirmationStatus === "confirmed" ||
			status?.confirmationStatus === "finalized"
		)
			return signature;
		const blockHeight = await rpc
			.getBlockHeight({ commitment: "confirmed" })
			.send();
		if (blockHeight > lifetime.value.lastValidBlockHeight)
			throw new Error(
				"The transaction expired before confirmation. No state change was accepted; check the explorer before retrying.",
			);
		await new Promise((resolve) => setTimeout(resolve, 1_000));
	}
	throw new Error(
		`The transaction ${signature} is still unconfirmed after 60 seconds. Check it on Solana Explorer before trying again.`,
	);
}
