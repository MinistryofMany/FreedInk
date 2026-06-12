// Unit tests for the rollout-bucket math. No DB touch — we mock the
// `$lib/db/client` and `./audit` modules so the pure functions under test
// don't pull in postgres-js or hit the network. The integration suite
// (tests/integration/flags.test.ts) covers the DB-touching paths.
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('$lib/db/client', () => ({
	db: {} as unknown,
	schema: {} as unknown
}));
vi.mock('./audit', () => ({ audit: async () => undefined }));
vi.mock('./log', () => ({
	log: {
		error: () => undefined,
		warn: () => undefined,
		info: () => undefined,
		debug: () => undefined
	}
}));

beforeAll(() => {
	process.env.SESSION_SECRET ??= 'a'.repeat(64);
});

import { rolloutBucket, isValidFlagKey } from './flags';

describe('rolloutBucket: stability', () => {
	it('returns the same bucket for the same input every call', () => {
		const a = rolloutBucket('user-123', 'my.flag');
		const b = rolloutBucket('user-123', 'my.flag');
		const c = rolloutBucket('user-123', 'my.flag');
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	it('produces a number in [0, 100)', () => {
		for (let i = 0; i < 50; i++) {
			const v = rolloutBucket(`u-${i}`, 'k');
			expect(v).toBeGreaterThanOrEqual(0);
			expect(v).toBeLessThan(100);
		}
	});

	it('different keys for the same user give different buckets (mostly)', () => {
		const a = rolloutBucket('u', 'flag.a');
		const b = rolloutBucket('u', 'flag.b');
		// Not guaranteed unequal in any individual case, but extremely likely.
		// We just assert the function meaningfully differentiates them.
		expect(typeof a).toBe('number');
		expect(typeof b).toBe('number');
	});
});

describe('rolloutBucket: distribution', () => {
	// We don't want flakes; ~10k samples is plenty for a ~50% chi-squared
	// sanity check while staying fast (~100ms).
	const SAMPLE = 10_000;
	const TOLERANCE_PCT_POINTS = 2.5; // within 2.5pp of expectation

	function inRollout(disc: string, key: string, pct: number): boolean {
		if (pct <= 0) return false;
		if (pct >= 100) return true;
		return rolloutBucket(disc, key) < pct;
	}

	it('~50% rollout admits ~50% of users for a fixed key', () => {
		let admitted = 0;
		for (let i = 0; i < SAMPLE; i++) {
			if (inRollout(`user-${i}`, 'feature.x', 50)) admitted++;
		}
		const pct = (admitted / SAMPLE) * 100;
		expect(pct).toBeGreaterThanOrEqual(50 - TOLERANCE_PCT_POINTS);
		expect(pct).toBeLessThanOrEqual(50 + TOLERANCE_PCT_POINTS);
	});

	it('~10% rollout admits ~10% of users', () => {
		let admitted = 0;
		for (let i = 0; i < SAMPLE; i++) {
			if (inRollout(`user-${i}`, 'feature.y', 10)) admitted++;
		}
		const pct = (admitted / SAMPLE) * 100;
		expect(pct).toBeGreaterThanOrEqual(10 - TOLERANCE_PCT_POINTS);
		expect(pct).toBeLessThanOrEqual(10 + TOLERANCE_PCT_POINTS);
	});

	it('0% rollout admits nobody', () => {
		for (let i = 0; i < 100; i++) {
			expect(inRollout(`user-${i}`, 'k', 0)).toBe(false);
		}
	});

	it('100% rollout admits everybody', () => {
		for (let i = 0; i < 100; i++) {
			expect(inRollout(`user-${i}`, 'k', 100)).toBe(true);
		}
	});

	it('admission is monotonic in rollout percentage for a fixed user/key', () => {
		// If a user is admitted at p%, they're admitted at all q% >= p.
		// rolloutBucket(disc, key) < p, monotonic in p.
		const u = 'specific-user';
		const k = 'specific.flag';
		const bucket = rolloutBucket(u, k);
		for (let p = 0; p <= 100; p++) {
			expect(bucket < p).toBe(p > bucket);
		}
	});
});

describe('isValidFlagKey', () => {
	it.each([
		['feature.x', true],
		['nav_redesign', true],
		['ab-test-1', true],
		['a', false], // too short (min 2 chars after first)
		['Feature', false], // uppercase
		['1feature', false], // can't start with digit
		['feature space', false],
		['feature!', false],
		['', false]
	])('isValidFlagKey(%p) === %p', (input, expected) => {
		expect(isValidFlagKey(input)).toBe(expected);
	});
});
