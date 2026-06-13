// /metrics endpoint access-control tests. The endpoint is NEVER public: a
// caller gets in only with a valid METRICS_BEARER token OR a platform-operator
// session; otherwise 403. The metrics payload itself is unchanged.
//
// The shared API server (tests/setup/api-global.ts) boots once with no
// METRICS_BEARER (none is set in .env.test), so the bearer path is OFF there
// and an operator session is the only way in. We use that server to exercise:
//   - unauthenticated / non-operator        -> 403
//   - platform-operator session             -> 200 (+ payload shape)
// A second sub-suite spawns a one-off node process *with* METRICS_BEARER set to
// exercise the bearer path (valid -> 200, wrong/absent -> 403) in isolation,
// since we cannot mutate the env of the already-booted shared server.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { api, asUser, BASE_URL } from './helpers';
import { makeUser } from '../setup/factories';

// PLATFORM_OPERATORS=platform-op in .env.test, so a user with that username is
// an operator and anyone else is not.
const OPERATOR_USERNAME = 'platform-op';

function assertPrometheusBody(body: string): void {
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
}

describe('GET /metrics (no METRICS_BEARER configured)', () => {
	it('rejects an unauthenticated request with 403', async () => {
		const res = await api('/metrics');
		expect(res.status).toBe(403);
		const ct = res.headers.get('content-type') ?? '';
		expect(ct).toMatch(/text\/plain/);
		expect(res.headers.get('cache-control')).toMatch(/no-store/);
		await res.text();
	});

	it('rejects a request bearing a token when no bearer is configured (403)', async () => {
		// With METRICS_BEARER unset there is no bearer path; a token does NOT
		// fall back to open access.
		const res = await api('/metrics', { headers: { authorization: 'Bearer anything' } });
		expect(res.status).toBe(403);
		await res.text();
	});

	it('rejects an authed non-operator session with 403', async () => {
		const u = await makeUser({ username: 'metrics-regular' });
		const { cookie } = await asUser(u);
		const res = await api('/metrics', { headers: { cookie } });
		expect(res.status).toBe(403);
		await res.text();
	});

	it('accepts a platform-operator session and returns 200 + Prometheus body', async () => {
		const op = await makeUser({ username: OPERATOR_USERNAME });
		const { cookie } = await asUser(op);
		const res = await api('/metrics', { headers: { cookie } });
		expect(res.status).toBe(200);
		const ct = res.headers.get('content-type') ?? '';
		expect(ct).toMatch(/text\/plain/);
		expect(ct).toMatch(/version=0\.0\.4/);
		expect(res.headers.get('cache-control')).toMatch(/no-store/);
		assertPrometheusBody(await res.text());
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
				throw new Error(
					`bearer server exited early (${child.exitCode}): ${stderr.join('').slice(-1000)}`
				);
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

	it('rejects an unauthenticated scrape with 403', async () => {
		const res = await fetch(URL + '/metrics');
		expect(res.status).toBe(403);
		// A bearer is configured, so the challenge header is advertised.
		expect(res.headers.get('www-authenticate')).toMatch(/Bearer/);
		await res.text();
	});

	it('rejects a wrong bearer with 403', async () => {
		const res = await fetch(URL + '/metrics', {
			headers: { authorization: 'Bearer not-the-token' }
		});
		expect(res.status).toBe(403);
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
