import { describe, it, expect } from 'vitest';
import { verifyMembership } from '$lib/server/semaphore';
import { setRole, removeMember } from '$lib/db/members';
import { currentMembership } from '$lib/db/snapshots';
import { makeUser, makeBlogWith, buildTestProof } from '../setup/factories';

describe('verifyMembership end-to-end', () => {
	it('accepts a valid proof generated against the current snapshot', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const { id: blogId } = await makeBlogWith({ owner });
		const proof = await buildTestProof({
			blogId,
			identity: owner.identity,
			scope: 'post:test',
			message: 'hello world'
		});
		const result = await verifyMembership({
			blogId,
			proof,
			expectedScope: 'post:test',
			expectedMessage: 'hello world'
		});
		expect(result.snapshot.root).toBe(proof.merkleTreeRoot);
		expect(result.nullifier).toBe(proof.nullifier);
	}, 30_000);

	it('rejects proof with wrong scope', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const { id: blogId } = await makeBlogWith({ owner });
		const proof = await buildTestProof({
			blogId,
			identity: owner.identity,
			scope: 'post:test',
			message: 'm'
		});
		await expect(
			verifyMembership({
				blogId,
				proof,
				expectedScope: 'review:test', // mismatch
				expectedMessage: 'm'
			})
		).rejects.toMatchObject({ status: 400 });
	}, 30_000);

	it('rejects proof with wrong message', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const { id: blogId } = await makeBlogWith({ owner });
		const proof = await buildTestProof({
			blogId,
			identity: owner.identity,
			scope: 'post:t',
			message: 'original message'
		});
		await expect(
			verifyMembership({
				blogId,
				proof,
				expectedScope: 'post:t',
				expectedMessage: 'tampered message'
			})
		).rejects.toMatchObject({ status: 400 });
	}, 30_000);

	it('rejects proof whose root is unknown for this blog', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const { id: blogA } = await makeBlogWith({ owner });
		const { id: blogB } = await makeBlogWith({ owner, title: 'B' });
		const proof = await buildTestProof({
			blogId: blogA,
			identity: owner.identity,
			scope: 'post:t',
			message: 'm'
		});
		// Even though blogA and blogB happen to share the same root (single
		// owner), getSnapshotByRoot only matches in the requesting blog. We
		// re-bind by querying blogA's identifier with blogB's id and a proof
		// whose root only exists for blogA. To force a true mismatch, mutate
		// the proof root.
		const fake = { ...proof, merkleTreeRoot: '9999999999999999999999' };
		await expect(
			verifyMembership({
				blogId: blogB,
				proof: fake,
				expectedScope: 'post:t',
				expectedMessage: 'm'
			})
		).rejects.toMatchObject({ status: 400 });
	}, 30_000);

	it('rejects a forged-points proof', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const { id: blogId } = await makeBlogWith({ owner });
		const proof = await buildTestProof({
			blogId,
			identity: owner.identity,
			scope: 'post:t',
			message: 'm'
		});
		// Flip the first point to invalidate the SNARK.
		const tampered = { ...proof, points: ['1', ...proof.points.slice(1)] };
		await expect(
			verifyMembership({
				blogId,
				proof: tampered,
				expectedScope: 'post:t',
				expectedMessage: 'm'
			})
		).rejects.toMatchObject({ status: 400 });
	}, 60_000);
});

// C3 (revocation): with requireCurrentRoot the proof must match the blog's
// CURRENT snapshot root, not just any historical one. A member who built a
// valid proof and is then removed (or whose snapshot rolls forward) can no
// longer author or edit against the now-stale root.
describe('verifyMembership requireCurrentRoot (C3)', () => {
	it('accepts a current-root proof when requireCurrentRoot is set', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const { id: blogId } = await makeBlogWith({ owner });
		const proof = await buildTestProof({
			blogId,
			identity: owner.identity,
			scope: 'post:t',
			message: 'm'
		});
		const result = await verifyMembership({
			blogId,
			proof,
			expectedScope: 'post:t',
			expectedMessage: 'm',
			requireCurrentRoot: true
		});
		expect(result.snapshot.root).toBe(proof.merkleTreeRoot);
	}, 30_000);

	it('rejects an authorship proof built against a now-stale root', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const author = await makeUser({ username: 'author', seed: 'author-seed' });
		const { id: blogId } = await makeBlogWith({
			owner,
			members: [{ user: author, role: 'author' }]
		});
		// author builds a valid proof against the current snapshot...
		const proof = await buildTestProof({
			blogId,
			identity: author.identity,
			scope: 'post:t',
			message: 'm'
		});
		const staleRoot = proof.merkleTreeRoot;

		// ...then the author is removed, rolling the current snapshot forward.
		await removeMember(blogId, author.id);
		const current = await currentMembership(blogId);
		expect(current.root).not.toBe(staleRoot);

		// The stale-root proof still references a KNOWN snapshot, so without the
		// flag it passes the lookup (SNARK is still valid for the old root)...
		const okWithoutFlag = await verifyMembership({
			blogId,
			proof,
			expectedScope: 'post:t',
			expectedMessage: 'm'
		});
		expect(okWithoutFlag.snapshot.root).toBe(staleRoot);

		// ...but with requireCurrentRoot (the authorship/edit path) it's rejected.
		await expect(
			verifyMembership({
				blogId,
				proof,
				expectedScope: 'post:t',
				expectedMessage: 'm',
				requireCurrentRoot: true
			})
		).rejects.toMatchObject({ status: 400 });
	}, 30_000);

	it('rejects a current-member proof once the snapshot rolls forward (C3)', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'owner-seed' });
		const { id: blogId } = await makeBlogWith({ owner });
		// owner builds a proof against the single-member snapshot...
		const proof = await buildTestProof({
			blogId,
			identity: owner.identity,
			scope: 'post:t',
			message: 'm'
		});
		const staleRoot = proof.merkleTreeRoot;

		// ...then a new member joins, advancing the current root.
		const joiner = await makeUser({ username: 'joiner', seed: 'joiner-seed' });
		await setRole(blogId, joiner.id, 'author', owner.id);
		const current = await currentMembership(blogId);
		expect(current.root).not.toBe(staleRoot);

		await expect(
			verifyMembership({
				blogId,
				proof,
				expectedScope: 'post:t',
				expectedMessage: 'm',
				requireCurrentRoot: true
			})
		).rejects.toMatchObject({ status: 400 });
	}, 30_000);
});
