// Smoke tests for the rate-limit middleware wired into endpoints.
//
// Strategy: hammer /api/nonce until we cross the configured threshold and
// expect 429s after that point. Between scenarios we truncate the rate_limits
// table so each test starts with a fresh window.
import { describe, it, expect, beforeEach } from 'vitest';
import { api, postJSON } from './helpers';
import { db, schema } from '$lib/db/client';
import { RULES } from '$lib/server/rate-limit';
import { sql } from 'drizzle-orm';

async function truncateRateLimits(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE ${schema.rateLimits}`);
}

describe('rate limit: /api/nonce', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('returns 200 under the threshold and 429 after it is crossed', async () => {
		const max = RULES.nonce.max;
		// Issue exactly `max` requests — all should succeed.
		for (let i = 0; i < max; i++) {
			const res = await api('/api/nonce');
			await res.text();
			expect(res.status, `request #${i + 1} should be allowed`).toBe(200);
		}
		// The next one should be over the limit.
		const overflow = await api('/api/nonce');
		await overflow.text();
		expect(overflow.status).toBe(429);
	});

	it('resets after the rate_limits table is cleared (simulates window rollover)', async () => {
		const max = RULES.nonce.max;
		for (let i = 0; i < max + 1; i++) {
			const res = await api('/api/nonce');
			await res.text();
		}
		// One last call should currently be 429 (we just blew past the limit).
		const blocked = await api('/api/nonce');
		await blocked.text();
		expect(blocked.status).toBe(429);

		// Simulate the window rolling over by clearing the table.
		await truncateRateLimits();

		const fresh = await api('/api/nonce');
		await fresh.text();
		expect(fresh.status).toBe(200);
	});
});

describe('rate limit: /api/auth/login/start', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('blocks once the authStart threshold is crossed', async () => {
		const max = RULES.authStart.max;
		// `email` is optional; the validator accepts an empty body and the
		// rate limit runs before any DB lookup, so each call is cheap.
		for (let i = 0; i < max; i++) {
			const res = await postJSON('/api/auth/login/start', {});
			await res.text();
			// We don't care whether the underlying logic returns 200/422/4xx —
			// just that the limiter did not yet kick in.
			expect(res.status, `request #${i + 1} should not be 429`).not.toBe(429);
		}
		const blocked = await postJSON('/api/auth/login/start', {});
		await blocked.text();
		expect(blocked.status).toBe(429);
	});
});
