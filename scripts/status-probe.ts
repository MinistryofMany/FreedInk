// Background HTTP probe for the self-hosted status page.
//
// Runs inside the `scheduler` container (alongside cleanup) and writes one
// `status_checks` row every STATUS_PROBE_INTERVAL_SECONDS. Each iteration:
//   1. fetches `${STATUS_PROBE_URL}` (defaults to http://app:3000/healthz so
//      we stay inside the docker network — no Caddy round-trip),
//   2. classifies the response into a status_level via classifyProbe(),
//   3. inserts a row with component='app', the level, latency, and any error.
//
// We don't import $lib/db/client — same reason scripts/cleanup.ts doesn't:
// SvelteKit's synthetic $env modules aren't available outside `vite dev`.
// Instead we open a tiny postgres-js client and write raw SQL.
import postgres from 'postgres';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// Tiny .env loader so `node scripts/status-probe.ts` works without dotenv.
if (existsSync('.env')) {
	for (const line of readFileSync('.env', 'utf8').split('\n')) {
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

export type StatusLevel = 'operational' | 'degraded' | 'partial_outage' | 'major_outage';

type Sql = ReturnType<typeof postgres>;

export type ProbeResult = {
	status: number | null;
	latencyMs: number;
	error: string | null;
	level: StatusLevel;
};

/**
 * Pure classifier — same thresholds as $lib/db/status.classifyProbe but
 * inlined here so the probe script can run in isolation (no app bundle).
 *   200 in <500ms        → operational
 *   200 in 500-2000ms    → degraded
 *   200 in >2000ms       → partial_outage
 *   non-2xx / fetch err  → major_outage
 */
export function classifyProbe(opts: {
	status: number | null;
	latencyMs: number;
	error: string | null;
}): StatusLevel {
	if (opts.error || opts.status === null || opts.status < 200 || opts.status >= 300) {
		return 'major_outage';
	}
	if (opts.latencyMs > 2_000) return 'partial_outage';
	if (opts.latencyMs >= 500) return 'degraded';
	return 'operational';
}

/**
 * Drive the probe against an arbitrary fetcher and persist the result. The
 * fetcher indirection lets tests inject mocks (slow / error / non-2xx)
 * without spinning up a real HTTP server. In production the caller passes
 * the real `fetch` along with the configured URL.
 */
export async function runProbeOnce(opts: {
	sql: Sql;
	url: string;
	component?: string;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
}): Promise<ProbeResult> {
	const component = opts.component ?? 'app';
	const timeoutMs = opts.timeoutMs ?? 5_000;
	const fetchImpl = opts.fetchImpl ?? fetch;

	const started = Date.now();
	let status: number | null = null;
	let errorMessage: string | null = null;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchImpl(opts.url, { signal: controller.signal });
		status = res.status;
		// Drain the body so the connection releases cleanly. Best-effort.
		try {
			await res.text();
		} catch {
			// ignore body drain failures — we already have the status.
		}
	} catch (err) {
		errorMessage = (err as Error).message || String(err);
	} finally {
		clearTimeout(timer);
	}

	const latencyMs = Date.now() - started;
	const level = classifyProbe({ status, latencyMs, error: errorMessage });

	await opts.sql`
		INSERT INTO status_checks (component, level, latency_ms, error)
		VALUES (${component}, ${level}, ${latencyMs}, ${errorMessage})
	`;

	return { status, latencyMs, error: errorMessage, level };
}

function logLine(payload: Record<string, unknown>) {
	process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...payload }) + '\n');
}

async function main() {
	const url = process.env.DATABASE_URL;
	if (!url) {
		logLine({ level: 'fatal', event: 'probe.no_database_url' });
		process.exit(2);
	}

	const probeUrl =
		process.env.STATUS_PROBE_URL ??
		(process.env.PUBLIC_ORIGIN
			? `${process.env.PUBLIC_ORIGIN.replace(/\/$/, '')}/healthz`
			: 'http://app:3000/healthz');
	const intervalSec = Number(process.env.STATUS_PROBE_INTERVAL_SECONDS ?? '30');
	if (!Number.isFinite(intervalSec) || intervalSec <= 0) {
		logLine({ level: 'fatal', event: 'probe.bad_interval', value: intervalSec });
		process.exit(2);
	}
	const timeoutMs = Number(process.env.STATUS_PROBE_TIMEOUT_MS ?? '5000');

	const once =
		process.argv.includes('--once') ||
		process.env.STATUS_PROBE_ONCE === '1' ||
		process.env.STATUS_PROBE_LOOP !== '1';

	const sentinelPath = resolve(process.env.STATUS_PROBE_SENTINEL ?? '/tmp/status-probe.last_ok');

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
				const result = await runProbeOnce({ sql, url: probeUrl, timeoutMs });
				logLine({
					level: 'info',
					event: 'probe.ok',
					url: probeUrl,
					status: result.status,
					latency_ms: result.latencyMs,
					status_level: result.level,
					duration_ms: Date.now() - start
				});
				try {
					mkdirSync(dirname(sentinelPath), { recursive: true });
					await writeFile(sentinelPath, String(Date.now()));
				} catch (err) {
					logLine({
						level: 'warn',
						event: 'probe.sentinel_failed',
						err: (err as Error).message
					});
				}
			} catch (err) {
				// runProbeOnce only throws if the DB insert itself fails.
				logLine({
					level: 'error',
					event: 'probe.failed',
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
