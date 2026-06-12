// Drive the extracted probe function against synthetic fetch responses and
// assert that the right status_level lands in status_checks. We don't spin
// up a real HTTP server here — that's covered by the API project's healthz
// test; here we just need to verify the classification + insert path.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';
import { runProbeOnce, classifyProbe } from '../../scripts/status-probe';
import { db, schema } from '$lib/db/client';
import { desc } from 'drizzle-orm';

const url = process.env.DATABASE_URL!;
let sql: ReturnType<typeof postgres>;

beforeAll(() => {
	sql = postgres(url, { max: 2, prepare: false });
});
afterAll(async () => {
	await sql.end();
});

// Build a fake fetch that resolves to a Response after `delayMs`, optionally
// throwing instead to simulate a network error. Honors the AbortSignal so
// the probe's timeout path actually rejects.
function fakeFetch(opts: { status?: number; delayMs?: number; error?: string }): typeof fetch {
	return (async (_input: RequestInfo | URL, init?: RequestInit) => {
		if (opts.delayMs) {
			await new Promise<void>((resolveP, rejectP) => {
				const t = setTimeout(() => {
					if (opts.error) rejectP(new Error(opts.error));
					else resolveP();
				}, opts.delayMs!);
				const sig = init?.signal as AbortSignal | undefined;
				if (sig) {
					if (sig.aborted) {
						clearTimeout(t);
						rejectP(new Error('aborted'));
						return;
					}
					sig.addEventListener('abort', () => {
						clearTimeout(t);
						rejectP(new Error('aborted'));
					});
				}
			});
		}
		if (opts.error) throw new Error(opts.error);
		return new Response('ok', { status: opts.status ?? 200 });
	}) as unknown as typeof fetch;
}

async function latestCheck() {
	const rows = await db
		.select()
		.from(schema.statusChecks)
		.orderBy(desc(schema.statusChecks.checkedAt))
		.limit(1);
	return rows[0];
}

describe('classifyProbe', () => {
	it('200 fast → operational', () => {
		expect(classifyProbe({ status: 200, latencyMs: 100, error: null })).toBe('operational');
	});
	it('200 medium → degraded', () => {
		expect(classifyProbe({ status: 200, latencyMs: 800, error: null })).toBe('degraded');
	});
	it('200 slow → partial_outage', () => {
		expect(classifyProbe({ status: 200, latencyMs: 3000, error: null })).toBe('partial_outage');
	});
	it('non-2xx → major_outage', () => {
		expect(classifyProbe({ status: 500, latencyMs: 50, error: null })).toBe('major_outage');
	});
	it('fetch error → major_outage', () => {
		expect(classifyProbe({ status: null, latencyMs: 10, error: 'ECONNREFUSED' })).toBe(
			'major_outage'
		);
	});
});

describe('runProbeOnce', () => {
	it('records an operational row on a fast 200', async () => {
		await sql`TRUNCATE TABLE status_checks RESTART IDENTITY`;
		const result = await runProbeOnce({
			sql,
			url: 'http://example.test/healthz',
			fetchImpl: fakeFetch({ status: 200, delayMs: 5 })
		});
		expect(result.level).toBe('operational');
		const row = await latestCheck();
		expect(row.component).toBe('app');
		expect(row.level).toBe('operational');
		expect(row.error).toBeNull();
		expect(row.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it('records a degraded row when latency is in the 500-2000ms band', async () => {
		await sql`TRUNCATE TABLE status_checks RESTART IDENTITY`;
		const result = await runProbeOnce({
			sql,
			url: 'http://example.test/healthz',
			fetchImpl: fakeFetch({ status: 200, delayMs: 600 })
		});
		expect(result.level).toBe('degraded');
		const row = await latestCheck();
		expect(row.level).toBe('degraded');
		expect(row.latencyMs).toBeGreaterThanOrEqual(500);
	});

	it('records a major_outage row on a non-2xx response', async () => {
		await sql`TRUNCATE TABLE status_checks RESTART IDENTITY`;
		const result = await runProbeOnce({
			sql,
			url: 'http://example.test/healthz',
			fetchImpl: fakeFetch({ status: 503, delayMs: 10 })
		});
		expect(result.level).toBe('major_outage');
		const row = await latestCheck();
		expect(row.level).toBe('major_outage');
	});

	it('records a major_outage row on a fetch throw', async () => {
		await sql`TRUNCATE TABLE status_checks RESTART IDENTITY`;
		const result = await runProbeOnce({
			sql,
			url: 'http://example.test/healthz',
			fetchImpl: fakeFetch({ error: 'ECONNREFUSED' })
		});
		expect(result.level).toBe('major_outage');
		expect(result.error).toMatch(/ECONNREFUSED/);
		const row = await latestCheck();
		expect(row.level).toBe('major_outage');
		expect(row.error).toMatch(/ECONNREFUSED/);
	});

	it('records a major_outage row when the request exceeds the timeout', async () => {
		await sql`TRUNCATE TABLE status_checks RESTART IDENTITY`;
		const result = await runProbeOnce({
			sql,
			url: 'http://example.test/healthz',
			timeoutMs: 100,
			fetchImpl: fakeFetch({ status: 200, delayMs: 500 })
		});
		expect(result.level).toBe('major_outage');
		expect(result.error).toBeTruthy();
	});
});
