import { describe, it, expect } from 'vitest';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';

// Snapshot-root reproducibility is the load-bearing invariant of the whole
// proof-verification pipeline: if we re-build the group from the same sorted
// identity list, we must arrive at the same root the original poster's proof
// was issued against.
describe('group root reproducibility', () => {
	it('produces the same root for the same sorted IDC set', () => {
		const ids = [new Identity(), new Identity(), new Identity()];
		const idcs = ids.map((i) => i.commitment.toString()).sort();

		const g1 = new Group();
		for (const c of idcs) g1.addMember(BigInt(c));

		const g2 = new Group();
		for (const c of idcs) g2.addMember(BigInt(c));

		expect(g1.root.toString()).toEqual(g2.root.toString());
	});

	it('is sensitive to insertion order if not sorted', () => {
		const ids = [new Identity(), new Identity(), new Identity()];
		const a = ids.map((i) => i.commitment.toString());
		const b = a.slice().reverse();

		const g1 = new Group();
		for (const c of a) g1.addMember(BigInt(c));

		const g2 = new Group();
		for (const c of b) g2.addMember(BigInt(c));

		expect(g1.root.toString()).not.toEqual(g2.root.toString());
	});
});
