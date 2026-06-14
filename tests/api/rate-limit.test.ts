// Smoke tests for the rate-limit middleware wired into endpoints.
//
// Strategy: hammer the "Sign in with Minister" start endpoint until we cross
// the configured threshold and expect 429s after that point. The limiter runs
// before the endpoint's own logic, so its status under the limit (302 redirect
// when Minister is configured, 503 when it isn't) is irrelevant — only the 429
// matters. `redirect: 'manual'` keeps us from chasing a 302 to an external IdP.
// Between scenarios we truncate the rate_limits table for a fresh window.
import { describe, it, expect, beforeEach } from 'vitest';
import { api } from './helpers';
import { db, schema } from '$lib/db/client';
import { RULES } from '$lib/server/rate-limit';
import { sql } from 'drizzle-orm';

const START = '/api/auth/oidc/start';
const startReq = () => api(START, { redirect: 'manual' });

async function truncateRateLimits(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE ${schema.rateLimits}`);
}

describe('rate limit: /api/auth/oidc/start (authStart)', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('stays under the limit then 429s once the threshold is crossed', async () => {
		const max = RULES.authStart.max;
		for (let i = 0; i < max; i++) {
			const res = await startReq();
			await res.text();
			expect(res.status, `request #${i + 1} should not be 429`).not.toBe(429);
		}
		const overflow = await startReq();
		await overflow.text();
		expect(overflow.status).toBe(429);
	});

	it('resets after the rate_limits table is cleared (simulates window rollover)', async () => {
		const max = RULES.authStart.max;
		for (let i = 0; i < max + 1; i++) {
			const res = await startReq();
			await res.text();
		}
		const blocked = await startReq();
		await blocked.text();
		expect(blocked.status).toBe(429);

		// Simulate the window rolling over by clearing the table.
		await truncateRateLimits();

		const fresh = await startReq();
		await fresh.text();
		expect(fresh.status).not.toBe(429);
	});
});
