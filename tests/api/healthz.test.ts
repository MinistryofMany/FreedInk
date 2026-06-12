// /healthz should be a tiny, predictable JSON probe. Cheap to assert; the
// API project's global setup already starts a real server backed by the test
// DB, so we just hit the endpoint and assert shape.
import { describe, it, expect } from 'vitest';
import { api } from './helpers';

describe('/healthz', () => {
	it('GET → 200 with JSON {status,db,ts}', async () => {
		const res = await api('/healthz');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toMatch(/application\/json/);
		// Probe must not be cached upstream.
		expect(res.headers.get('cache-control')).toMatch(/no-store/);

		const body = (await res.json()) as Record<string, unknown>;
		expect(body.status).toBe('ok');
		expect(body.db).toBe('ok');
		expect(typeof body.ts).toBe('string');
		// ts must be a parseable ISO timestamp.
		expect(Number.isNaN(Date.parse(body.ts as string))).toBe(false);
	});

	it('responds quickly (under 1s) when DB is healthy', async () => {
		const t0 = Date.now();
		const res = await api('/healthz');
		const elapsed = Date.now() - t0;
		expect(res.status).toBe(200);
		expect(elapsed).toBeLessThan(1_000);
	});
});
