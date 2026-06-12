import { describe, it, expect } from 'vitest';
import { verifyMembership } from '$lib/server/semaphore';
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
