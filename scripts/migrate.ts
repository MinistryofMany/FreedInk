// Apply pending Drizzle migrations. Wrapped in a Postgres advisory lock so
// that two app instances starting simultaneously (e.g. on a rolling deploy)
// don't race to apply the same statements — only one runs the migrator, the
// other waits up to 60s and either acquires the lock (and finds no work to
// do) or fails loudly.
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env')) {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');

// Fixed key for the migration lock. Chosen arbitrarily but stable — any other
// caller racing for this same int64 will block / be told to wait. Picking a
// large constant rather than e.g. `hashtext('freedink-migrations')` keeps the
// behaviour deterministic across PG versions.
const MIGRATION_LOCK_KEY = 4523769201337n;

const WAIT_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

const sql = postgres(url, { max: 1, prepare: false });
const db = drizzle(sql);

async function tryLock(): Promise<boolean> {
	const rows = await sql<{ acquired: boolean }[]>`
		SELECT pg_try_advisory_lock(${MIGRATION_LOCK_KEY}::bigint) AS acquired
	`;
	return rows[0]?.acquired === true;
}

async function releaseLock(): Promise<void> {
	// pg_advisory_unlock returns boolean; ignore the result.
	await sql`SELECT pg_advisory_unlock(${MIGRATION_LOCK_KEY}::bigint)`;
}

const startedWaitingAt = Date.now();
let acquired = await tryLock();
let weHeldTheLock = acquired;

if (!acquired) {
	console.log(
		`[migrate] another process holds the migration lock (key=${MIGRATION_LOCK_KEY}); waiting up to ${WAIT_TIMEOUT_MS / 1000}s…`
	);
	while (!acquired && Date.now() - startedWaitingAt < WAIT_TIMEOUT_MS) {
		await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
		acquired = await tryLock();
		if (acquired) weHeldTheLock = true;
	}
	if (!acquired) {
		await sql.end();
		throw new Error(
			`[migrate] timed out waiting ${WAIT_TIMEOUT_MS}ms for migration lock; aborting`
		);
	}
	console.log('[migrate] acquired lock after waiting; running migrator');
} else {
	console.log(`[migrate] acquired migration lock (key=${MIGRATION_LOCK_KEY})`);
}

try {
	await migrate(db, { migrationsFolder: './migrations' });
	console.log('migrations applied');
} finally {
	if (weHeldTheLock) {
		try {
			await releaseLock();
		} catch (err) {
			// Connection-end will release automatically; just note the issue.
			console.warn('[migrate] failed to release advisory lock:', (err as Error).message);
		}
	}
	await sql.end();
}
