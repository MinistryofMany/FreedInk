// /metrics endpoint smoke tests. The server boots once for the whole API
// suite (tests/setup/api-global.ts), so we can't *mutate* METRICS_BEARER
// at runtime to flip auth on and off. Instead:
//   - The default-built test server has no METRICS_BEARER → "unauth → 200"
//     paths are validated here.
//   - A second sub-suite spawns a one-off node process with the env var set
//     to validate the 401-on-no-token / 200-with-token paths in isolation.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { api, BASE_URL } from './helpers';

describe('GET /metrics (open, no bearer)', () => {
	it('returns 200 text/plain in Prometheus exposition format', async () => {
		const res = await api('/metrics');
		expect(res.status).toBe(200);
		const ct = res.headers.get('content-type') ?? '';
		expect(ct).toMatch(/text\/plain/);
		expect(ct).toMatch(/version=0\.0\.4/);
		expect(res.headers.get('cache-control')).toMatch(/no-store/);

		const body = await res.text();
		// HELP / TYPE lines per metric.
		expect(body).toMatch(/^# HELP freedink_users_total /m);
		expect(body).toMatch(/^# TYPE freedink_users_total gauge$/m);
		expect(body).toMatch(/^freedink_users_total \d+$/m);

		// Labels round-trip for blogs (archived="false"/"true") and posts (status=...).
		expect(body).toMatch(/freedink_blogs_total\{archived="false"\} \d+/);
		expect(body).toMatch(/freedink_blogs_total\{archived="true"\} \d+/);
		expect(body).toMatch(/freedink_posts_total\{status="draft"\} \d+/);
		expect(body).toMatch(/freedink_posts_total\{status="under_review"\} \d+/);
		expect(body).toMatch(/freedink_posts_total\{status="published"\} \d+/);
		expect(body).toMatch(/freedink_posts_total\{status="rejected"\} \d+/);
		expect(body).toMatch(/freedink_reviews_total\{vote="approve"\} \d+/);
		expect(body).toMatch(/freedink_reviews_total\{vote="reject"\} \d+/);

		// Other expected names.
		expect(body).toMatch(/freedink_users_suspended /);
		expect(body).toMatch(/freedink_comments_total /);
		expect(body).toMatch(/freedink_abuse_reports_open /);
		expect(body).toMatch(/freedink_active_sessions /);
		expect(body).toMatch(/freedink_rate_limit_blocks_24h /);

		// Histogram emits _bucket / _sum / _count families.
		expect(body).toMatch(/^# TYPE freedink_db_query_duration_seconds histogram$/m);
		expect(body).toMatch(/freedink_db_query_duration_seconds_bucket\{le="\+Inf"\} 1/);
		expect(body).toMatch(/freedink_db_query_duration_seconds_count 1/);

		// Trailing newline.
		expect(body.endsWith('\n')).toBe(true);
	});

	it('does not require any auth', async () => {
		const res = await api('/metrics', { headers: { authorization: 'Bearer wrong' } });
		// Without METRICS_BEARER set, the Authorization header is ignored and the
		// request succeeds anyway.
		expect(res.status).toBe(200);
		await res.text();
	});
});

describe('GET /metrics (with METRICS_BEARER set)', () => {
	const PORT = Number(process.env.TEST_SERVER_PORT ?? '5174') + 1;
	const HOST = '127.0.0.1';
	const URL = `http://${HOST}:${PORT}`;
	const BEARER = 'super-secret-scrape-token';
	let child: ChildProcess | null = null;

	beforeAll(async () => {
		child = spawn('node', ['build'], {
			stdio: ['ignore', 'pipe', 'pipe'],
			env: {
				...process.env,
				PORT: String(PORT),
				HOST,
				ORIGIN: URL,
				PUBLIC_ORIGIN: URL,
				METRICS_BEARER: BEARER,
				NODE_ENV: 'production',
				...(process.env.VERBOSE_TEST_SERVER ? {} : { DEBUG: '' })
			}
		});
		const stderr: string[] = [];
		child.stderr?.on('data', (b) => stderr.push(String(b)));
		if (process.env.VERBOSE_TEST_SERVER) {
			child.stdout?.on('data', (b) => process.stdout.write(String(b)));
			child.stderr?.on('data', (b) => process.stderr.write(String(b)));
		}
		const deadline = Date.now() + 30_000;
		while (Date.now() < deadline) {
			try {
				const res = await fetch(URL + '/healthz');
				if (res.ok) return;
			} catch {
				// not ready yet
			}
			if (child.exitCode !== null) {
				throw new Error(`bearer server exited early (${child.exitCode}): ${stderr.join('').slice(-1000)}`);
			}
			await wait(200);
		}
		throw new Error('bearer server did not become ready');
	}, 45_000);

	afterAll(async () => {
		if (!child) return;
		const c = child;
		child = null;
		c.kill('SIGTERM');
		await new Promise<void>((r) => {
			c.on('exit', () => r());
			setTimeout(() => {
				c.kill('SIGKILL');
				r();
			}, 5000);
		});
	});

	it('rejects unauthenticated scrape with 401', async () => {
		const res = await fetch(URL + '/metrics');
		expect(res.status).toBe(401);
		expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
		await res.text();
	});

	it('rejects wrong bearer with 401', async () => {
		const res = await fetch(URL + '/metrics', {
			headers: { authorization: 'Bearer not-the-token' }
		});
		expect(res.status).toBe(401);
		await res.text();
	});

	it('accepts the configured bearer and returns 200', async () => {
		const res = await fetch(URL + '/metrics', {
			headers: { authorization: `Bearer ${BEARER}` }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/text\/plain/);
		expect(res.headers.get('cache-control')).toMatch(/no-store/);
		const body = await res.text();
		expect(body).toMatch(/freedink_users_total /);
	});
});

// Sanity: the default server URL is reachable so we know the test harness
// itself is healthy before judging /metrics output.
describe('metrics test prereqs', () => {
	it('default test server responds to /healthz', async () => {
		const res = await fetch(BASE_URL + '/healthz');
		expect(res.status).toBe(200);
		await res.text();
	});
});
