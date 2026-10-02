import { spawnSync } from "node:child_process";
import process from "node:process";

const paths = ["./apps/web/", "./apps/server/", "./packages/db/"];

if (process.platform === "win32") {
	console.warn(
		"[env] Varlock codegen is skipped on Windows because its native helper can abort Bun; the checked-in server env contract remains available, and CI regenerates all env types on Linux.",
	);
	process.exit(0);
}

for (const path of paths) {
	const result = spawnSync("bun", ["x", "varlock", "codegen", "--path", path], {
		stdio: "inherit",
	});
	if (result.status !== 0) process.exit(result.status ?? 1);
}
