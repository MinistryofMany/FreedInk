// Node CLI wrapper around `pg_dump` for manual backups (`npm run backup`).
//
// Reads DATABASE_URL, parses out host/port/user/password/db, then spawns the
// system `pg_dump` (must be installed locally — we don't bundle libpq). Writes
// a custom-format dump under ./backups/ with a timestamped name.
//
// We deliberately don't share code with scripts/backup.sh — the shell version
// runs inside an alpine container with libpq present; this one targets dev /
// CI machines where pg_dump may or may not match the server version exactly.
// Mismatch produces a warning but usually still works for --format=custom.
import { spawn } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Tiny .env loader — keeps this script standalone (no dotenv dep).
if (existsSync('.env')) {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

const url = process.env.DATABASE_URL;
if (!url) {
	console.error('error: DATABASE_URL is required');
	process.exit(2);
}

const parsed = (() => {
	try {
		return new URL(url);
	} catch (err) {
		console.error('error: DATABASE_URL is not a valid URL:', (err as Error).message);
		process.exit(2);
	}
})();

const host = parsed.hostname || 'localhost';
const port = parsed.port || '5432';
const user = decodeURIComponent(parsed.username || 'postgres');
const password = decodeURIComponent(parsed.password || '');
const database = (parsed.pathname || '/').slice(1) || 'postgres';

const outDir = resolve(process.env.BACKUP_DIR ?? './backups');
await mkdir(outDir, { recursive: true });

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+$/, 'Z');
const outFile = resolve(outDir, `freedink-${ts}.dump`);
// pg_dump --file writes directly to outFile; on failure we may end up with a
// truncated artefact. Write to a .partial first and rename on success so
// listings only ever show complete dumps.
const partialFile = outFile + '.partial';

// Allow operator override (helpful when local pg_dump's major version doesn't
// match the server and they want to point at a docker exec wrapper instead).
const bin = process.env.PG_DUMP_BIN ?? 'pg_dump';

console.error(
	JSON.stringify({
		event: 'backup.start',
		host,
		port,
		database,
		user,
		out: outFile,
		bin,
		ts: new Date().toISOString()
	})
);

const args = [
	'--format=custom',
	'--no-owner',
	'--no-acl',
	'--host',
	host,
	'--port',
	port,
	'--username',
	user,
	'--file',
	partialFile,
	database
];

const child = spawn(bin, args, {
	stdio: ['ignore', 'inherit', 'inherit'],
	env: { ...process.env, PGPASSWORD: password }
});

const code: number = await new Promise((resolveP, rejectP) => {
	child.on('exit', (c) => resolveP(c ?? 1));
	child.on('error', (err) => {
		if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
			console.error(
				`error: '${bin}' not found on PATH. Install postgres client tools or set PG_DUMP_BIN.`
			);
			resolveP(127);
		} else {
			rejectP(err);
		}
	});
});

if (code !== 0) {
	// Clean up the partial artefact so subsequent runs don't get confused.
	try {
		const { unlink } = await import('node:fs/promises');
		await unlink(partialFile);
	} catch {
		/* ignore */
	}
	console.error(JSON.stringify({ event: 'backup.failed', code, out: outFile }));
	process.exit(code);
}

const { rename } = await import('node:fs/promises');
await rename(partialFile, outFile);
const size = (await stat(outFile)).size;
console.error(
	JSON.stringify({
		event: 'backup.ok',
		out: outFile,
		bytes: size,
		ts: new Date().toISOString()
	})
);
