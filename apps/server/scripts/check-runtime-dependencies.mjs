import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = dirname(fileURLToPath(import.meta.url));
const distDirectory = join(packageDirectory, "..", "dist");
const runtimeManifestPath = join(
	packageDirectory,
	"..",
	"package.runtime.json",
);
const runtimeManifest = JSON.parse(await readFile(runtimeManifestPath, "utf8"));
const runtimeDependencies = new Set(
	Object.keys(runtimeManifest.dependencies ?? {}),
);

async function collectBundleFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true });
	const files = [];
	for (const entry of entries) {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) files.push(...(await collectBundleFiles(path)));
		else if (entry.isFile() && entry.name.endsWith(".mjs")) files.push(path);
	}
	return files;
}

function packageName(specifier) {
	if (
		specifier.startsWith("node:") ||
		specifier.startsWith(".") ||
		specifier.startsWith("/")
	) {
		return null;
	}
	const parts = specifier.split("/");
	return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

const externalPackages = new Set();
for (const file of await collectBundleFiles(distDirectory)) {
	const contents = await readFile(file, "utf8");
	const staticImports = contents.matchAll(
		/^(?:import|export)\s+(?:[^;\n]*?\s+from\s+)?["']([^"']+)["']/gm,
	);
	for (const [, specifier] of staticImports) {
		const name = packageName(specifier);
		if (name) externalPackages.add(name);
	}
}

const missing = [...externalPackages]
	.filter((name) => !runtimeDependencies.has(name))
	.sort();

if (missing.length > 0) {
	console.error(
		`Missing runtime dependencies for external server imports: ${missing.join(", ")}`,
	);
	process.exitCode = 1;
} else {
	console.log(
		`Verified ${externalPackages.size} external server packages are declared for runtime installation.`,
	);
}
