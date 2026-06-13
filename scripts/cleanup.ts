// Background reaper for ephemeral / expired rows.
//
// Runs on a fixed interval inside the `scheduler` container, and also exposes
// `runCleanupOnce()` for tests and ad-hoc `npm run cleanup` invocations.
//
// Why this doesn't import $lib/db/client: that module pulls in
// `$env/dynamic/private` and `$app/environment`, both of which only resolve
// inside SvelteKit (synthetic modules from `svelte-kit sync`). Scripts run
// from the CLI without those bindings, so we open our own postgres client
// here and stick to raw SQL — simpler, fewer moving parts.
//
// Concurrency safety: every statement is a plain WHERE-bounded DELETE. The
// app can be processing requests at the same time; row-level locks keep
// things consistent. We don't take table locks.
import postgres from 'postgres';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Tiny .env loader so `npm run cleanup` works without dotenv.
if (existsSync('.env')) {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

export type CleanupStats = {
	sessions: number;
	oidc_sessions: number;
	post_submission_nonces: number;
	rate_limits: number;
	blog_invitations: number;
	status_checks: number;
};

// Status-page probe rows past this horizon get reaped each tick. 90 days
// keeps ~260k rows at the default 30s probe cadence — plenty to render the
// public 90-day uptime grid while bounding storage cost.
const STATUS_CHECKS_RETENTION_DAYS = 90;

type Sql = ReturnType<typeof postgres>;

/**
 * Reap expired / consumed / revoked rows from the tables that accumulate
 * ephemeral state. Returns counts per table. Safe to call repeatedly.
 *
 * The `sql` connection should be a small (max 1–2) client; the deletes are
 * cheap individually but doing them in a single round-trip per table keeps
 * the logic boring.
 */
export async function runCleanupOnce(sql: Sql): Promise<CleanupStats> {
	const stats: CleanupStats = {
		sessions: 0,
		oidc_sessions: 0,
		post_submission_nonces: 0,
		rate_limits: 0,
		blog_invitations: 0,
		status_checks: 0
	};

	// sessions: expired (`expires_at < now()`).
	stats.sessions = (
		await sql`
		DELETE FROM sessions WHERE expires_at < now()
	`
	).count;

	// oidc_sessions: short-lived pending OIDC authorizations. Resolved rows are
	// deleted on use; this reaps the ones that expired before the IdP redirected
	// back (`expires_at < now()`), as the schema comment promises.
	stats.oidc_sessions = (
		await sql`
		DELETE FROM oidc_sessions WHERE expires_at < now()
	`
	).count;

	// post_submission_nonces: one-shot — expired or already consumed.
	stats.post_submission_nonces = (
		await sql`
		DELETE FROM post_submission_nonces
		WHERE expires_at < now() OR consumed_at IS NOT NULL
	`
	).count;

	// rate_limits: past the window expiry.
	stats.rate_limits = (
		await sql`
		DELETE FROM rate_limits WHERE expires_at < now()
	`
	).count;

	// blog_invitations: revoked OR past expires_at (and not yet accepted —
	// keep accepted ones for audit trail since they reference a real account).
	stats.blog_invitations = (
		await sql`
		DELETE FROM blog_invitations
		WHERE accepted_at IS NULL
		  AND (revoked_at IS NOT NULL OR expires_at < now())
	`
	).count;

	// status_checks: bounded by the retention horizon. Pure time-based reap
	// (no expires_at column) so the public /status page's 90-day uptime grid
	// always has something to draw from without unbounded growth.
	stats.status_checks = (
		await sql`
		DELETE FROM status_checks
		WHERE checked_at < now() - (${STATUS_CHECKS_RETENTION_DAYS}::int * interval '1 day')
	`
	).count;

	return stats;
}

function logLine(payload: Record<string, unknown>) {
	// Single JSON line per event — log shippers can parse this directly.
	// Use stderr so stdout stays available for any future structured output.
	process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		logLine({ level: 'fatal', event: 'cleanup.no_database_url' });
		process.exit(2);
	}

	const intervalSec = Number(process.env.CLEANUP_INTERVAL_SECONDS ?? '600');
	if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
		logLine({ level: 'fatal', event: 'cleanup.bad_interval', value: intervalSec });
		process.exit(2);
	}

	// Mode: a single execution (`--once`) for `npm run cleanup` / tests, or a
	// long-running loop for the scheduler container.
	const once =
		process.argv.includes('--once') ||
		process.env.CLEANUP_ONCE === '1' ||
		// When invoked directly via `npm run cleanup` (no CLEANUP_LOOP=1),
		// default to a single pass — otherwise the script never exits.
		process.env.CLEANUP_LOOP !== '1';

	const sentinelPath = resolve(process.env.CLEANUP_SENTINEL ?? '/tmp/cleanup.last_ok');

	const sql = postgres(url, { max: 2, prepare: false, idle_timeout: 5 });

	let stop = false;
	const onSignal = () => {
		stop = true;
	};
	process.on('SIGTERM', onSignal);
	process.on('SIGINT', onSignal);

	try {
		do {
			const start = Date.now();
			try {
				const stats = await runCleanupOnce(sql);
				const total = Object.values(stats).reduce((a, b) => a + b, 0);
				logLine({
					level: 'info',
					event: 'cleanup.ok',
					duration_ms: Date.now() - start,
					total,
					stats
				});
				try {
					mkdirSync(dirname(sentinelPath), { recursive: true });
					await writeFile(sentinelPath, String(Date.now()));
				} catch (err) {
					// Sentinel write isn't critical to the cleanup itself.
					logLine({
						level: 'warn',
						event: 'cleanup.sentinel_failed',
						err: (err as Error).message
					});
				}
			} catch (err) {
				logLine({
					level: 'error',
					event: 'cleanup.failed',
					err: (err as Error).message,
					duration_ms: Date.now() - start
				});
				if (once) {
					await sql.end();
					process.exit(1);
				}
			}

			if (once) break;

			// Sleep in 1s slices so SIGTERM/SIGINT lands quickly.
			let slept = 0;
			while (slept < intervalSec && !stop) {
				await new Promise<void>((r) => setTimeout(r, 1000));
				slept += 1;
			}
		} while (!stop);
	} finally {
		await sql.end({ timeout: 5 });
	}
}

// Detect direct execution: import.meta.url matches process.argv[1].
const invokedDirectly = (() => {
	try {
		const arg = process.argv[1];
		if (!arg) return false;
		const argUrl = new URL('file://' + resolve(arg)).href;
		return argUrl === import.meta.url;
	} catch {
		return false;
	}
})();

if (invokedDirectly) {
	await main();
}
