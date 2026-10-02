import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for migrations");

const migrationsRoot = join(
	dirname(fileURLToPath(import.meta.url)),
	"migrations",
);
const pool = new Pool({ connectionString: databaseUrl });

try {
	await pool.query('CREATE SCHEMA IF NOT EXISTS "drizzle"');
	await pool.query(`
		CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
			"id" serial PRIMARY KEY,
			"hash" text NOT NULL,
			"created_at" bigint
		)
	`);

	const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
		.filter((entry) => entry.isDirectory())
		.sort((a, b) => a.name.localeCompare(b.name));
	const legacyInitialTables = [
		"account",
		"bounty",
		"chain_cursor",
		"claim",
		"github_installation",
		"job",
		"rate_limit",
		"repository",
		"session",
		"settlement",
		"user",
		"verification",
		"wallet_link",
		"wallet_link_challenge",
		"webhook_delivery",
	];

	for (const [index, entry] of entries.entries()) {
		const migrationUrl = pathToFileURL(
			join(migrationsRoot, entry.name, "migration.sql"),
		);
		const migration = await readFile(migrationUrl, "utf8");
		const hash = createHash("sha256").update(migration).digest("hex");
		const applied = await pool.query(
			' SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE "hash" = $1 LIMIT 1',
			[hash],
		);
		if (applied.rowCount) continue;

		// The first generated migration was previously applied by Drizzle before
		// this runtime runner was introduced. Its SQL was then amended to include
		// pgcrypto, which changed the hash even though the schema was complete.
		// Adopt that existing schema once instead of trying to recreate tables.
		if (index === 0) {
			const existingSchema = await pool.query(
				`SELECT count(*)::int AS count
				 FROM information_schema.tables
				 WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
				[legacyInitialTables],
			);
			if (existingSchema.rows[0]?.count === legacyInitialTables.length) {
				await pool.query(
					'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
					[hash, Date.now()],
				);
				console.log(`[migrate] recorded existing schema ${entry.name}`);
				continue;
			}
		}

		const client = await pool.connect();
		try {
			await client.query("BEGIN");
			for (const statement of migration.split(
				/^--> statement-breakpoint\s*$/m,
			)) {
				if (statement.trim()) await client.query(statement);
			}
			await client.query(
				'INSERT INTO "drizzle"."__drizzle_migrations" ("hash", "created_at") VALUES ($1, $2)',
				[hash, Date.now()],
			);
			await client.query("COMMIT");
			console.log(`[migrate] applied ${entry.name}`);
		} catch (error) {
			await client.query("ROLLBACK");
			throw error;
		} finally {
			client.release();
		}
	}
} finally {
	await pool.end();
}
