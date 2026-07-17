import { describe, it, expect } from 'vitest';
import { decideLeafEnroll } from './leaf-enroll';

// C1: per-blog leaf replacement is gated on the signed Ministry epoch STRICTLY
// advancing past the epoch the current leaf was keyed at. These pin the exact
// rule the enroll endpoint runs.
describe('decideLeafEnroll (C1 leaf-replacement gate)', () => {
	it('inserts the first leaf when none is enrolled', () => {
		expect(
			decideLeafEnroll({ currentIdc: null, currentEpoch: null, newIdc: 'A', tokenEpoch: 1 })
		).toEqual({ action: 'insert' });
	});

	it('is a no-op when the same commitment is re-enrolled (any device, same branch)', () => {
		expect(
			decideLeafEnroll({ currentIdc: 'A', currentEpoch: 1, newIdc: 'A', tokenEpoch: 1 })
		).toEqual({ action: 'noop' });
		// Even if the token epoch is higher, an unchanged commitment never writes.
		expect(
			decideLeafEnroll({ currentIdc: 'A', currentEpoch: 1, newIdc: 'A', tokenEpoch: 9 })
		).toEqual({ action: 'noop' });
	});

	it('REFUSES a replacement at an equal epoch (the core anti-RLN-loop guard)', () => {
		expect(
			decideLeafEnroll({ currentIdc: 'A', currentEpoch: 1, newIdc: 'B', tokenEpoch: 1 })
		).toEqual({ action: 'reject', reason: 'stale-epoch' });
	});

	it('REFUSES a replacement at a lower epoch (stale device cannot clobber)', () => {
		expect(
			decideLeafEnroll({ currentIdc: 'A', currentEpoch: 5, newIdc: 'B', tokenEpoch: 3 })
		).toEqual({ action: 'reject', reason: 'stale-epoch' });
	});

	it('replaces only when the signed epoch STRICTLY advances', () => {
		expect(
			decideLeafEnroll({ currentIdc: 'A', currentEpoch: 1, newIdc: 'B', tokenEpoch: 2 })
		).toEqual({ action: 'replace' });
	});

	it('fails closed when there is no authoritative epoch to key on', () => {
		expect(
			decideLeafEnroll({ currentIdc: null, currentEpoch: null, newIdc: 'A', tokenEpoch: null })
		).toEqual({ action: 'reject', reason: 'no-epoch' });
		// Even a replacement request with no epoch is refused (never trust a bare mismatch).
		expect(
			decideLeafEnroll({ currentIdc: 'A', currentEpoch: 1, newIdc: 'B', tokenEpoch: null })
		).toEqual({ action: 'reject', reason: 'no-epoch' });
	});
});
