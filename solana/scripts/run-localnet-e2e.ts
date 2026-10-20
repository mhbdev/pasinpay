import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection } from "@solana/web3.js";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const image =
	process.env.PASINPAY_ANCHOR_IMAGE ?? "quay.io/ottersec/anchor:v1.2.1";
const rpcUrl = "http://127.0.0.1:8899";
const connection = new Connection(rpcUrl, "confirmed");
const containerName = `pasinpay-solana-e2e-${process.pid}`;

function run(
	command: string,
	args: string[],
	options: { cwd?: string; capture?: boolean } = {},
) {
	return new Promise<string>((resolvePromise, rejectPromise) => {
		const child = spawn(command, args, {
			cwd: options.cwd,
			windowsHide: true,
			stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
		});
		let output = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			if (options.capture) process.stdout.write(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			output += chunk.toString();
			if (options.capture) process.stderr.write(chunk);
		});
		child.once("error", rejectPromise);
		child.once("exit", (code) => {
			if (code === 0) resolvePromise(output);
			else
				rejectPromise(
					new Error(`${command} exited with status ${code ?? "unknown"}`),
				);
		});
	});
}

async function waitForValidator() {
	const deadline = Date.now() + 180_000;
	let lastError: unknown;
	while (Date.now() < deadline) {
		try {
			await connection.getVersion();
			return;
		} catch (error) {
			lastError = error;
			await new Promise((done) => setTimeout(done, 1_000));
		}
	}
	throw new Error(
		`Solana local validator did not become ready: ${String(lastError)}`,
	);
}

await run(process.execPath, ["scripts/ensure-localnet-wallet.ts"], {
	cwd: projectRoot,
});
const programSource = await readFile(
	resolve(projectRoot, "programs/pasinpay/src/lib.rs"),
	"utf8",
);
const programId = programSource.match(
	/declare_id!\("([1-9A-HJ-NP-Za-km-z]+)"\);/,
)?.[1];
if (!programId)
	throw new Error("Could not read the Anchor program ID from lib.rs");

await run(
	"docker",
	[
		"run",
		"--rm",
		"-v",
		`${projectRoot}:/workspace`,
		"-w",
		"/workspace",
		image,
		"cargo",
		"build-sbf",
		"--manifest-path",
		"programs/pasinpay/Cargo.toml",
		"--sbf-out-dir",
		"target/deploy",
	],
	{ capture: true },
);

try {
	const existingValidator = await connection.getVersion().then(
		() => true,
		() => false,
	);
	if (existingValidator)
		throw new Error(
			"Port 8899 already has a Solana RPC. Stop that validator before running the isolated E2E suite.",
		);
	await run("docker", [
		"run",
		"--detach",
		"--name",
		containerName,
		"--publish",
		"8899:8899",
		"--volume",
		`${projectRoot}:/workspace`,
		"--workdir",
		"/workspace",
		"--entrypoint",
		"solana-test-validator",
		image,
		"--reset",
		"--ledger",
		"/tmp/pasinpay-solana-e2e-ledger",
		"--bpf-program",
		programId,
		"target/deploy/pasinpay_escrow.so",
		"--rpc-port",
		"8899",
		"--faucet-port",
		"9900",
		"--bind-address",
		"0.0.0.0",
	]);
	try {
		await waitForValidator();
	} catch (cause) {
		await run(
			"docker",
			["inspect", "--format", "{{json .State}}", containerName],
			{ capture: true },
		).catch(() => undefined);
		await run("docker", ["top", containerName], { capture: true }).catch(
			() => undefined,
		);
		await run(
			"docker",
			[
				"exec",
				containerName,
				"bash",
				"-lc",
				"tail -n 200 /tmp/pasinpay-solana-e2e-ledger/validator.log",
			],
			{ capture: true },
		).catch(() => undefined);
		await run("docker", ["logs", containerName], { capture: true }).catch(
			() => undefined,
		);
		throw cause;
	}
	await run(
		process.execPath,
		["test", "--timeout=120000", "tests/escrow.e2e.test.ts"],
		{ cwd: projectRoot },
	);
} finally {
	await run("docker", ["stop", "--timeout", "10", containerName]).catch(
		() => undefined,
	);
	await run("docker", ["rm", "--force", containerName]).catch(() => undefined);
}
