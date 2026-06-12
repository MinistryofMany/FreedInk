import { error } from '@sveltejs/kit';
import { getSnapshotByRoot } from '$lib/db/snapshots';
import { hashToField } from '$lib/utils';

export type IncomingProof = {
	merkleTreeDepth: number;
	merkleTreeRoot: string;
	nullifier: string;
	message: string;
	scope: string;
	points: string[];
};

// Look up the snapshot the proof is bound to, verify the proof's scope and
// signal match what the server expected, then verify the SNARK. Returns
// {snapshot, nullifier} on success; throws SvelteKit errors otherwise.
export async function verifyMembership(opts: {
	blogId: string;
	proof: IncomingProof;
	expectedScope: string;
	expectedMessage: string;
}) {
	const { proof, blogId, expectedScope, expectedMessage } = opts;

	const snap = await getSnapshotByRoot(blogId, proof.merkleTreeRoot);
	if (!snap) throw error(400, 'proof references unknown membership snapshot');

	const expectedScopeField = (await hashToField(expectedScope)).toString();
	const expectedMessageField = (await hashToField(expectedMessage)).toString();
	if (proof.scope !== expectedScopeField) throw error(400, 'proof scope mismatch');
	if (proof.message !== expectedMessageField) throw error(400, 'proof message mismatch');

	// Lazy-load: @semaphore-protocol/proof eagerly pulls snarkjs+web-worker,
	// which crashes when imported during SvelteKit's SSR bundling pass.
	const { verifyProof } = await import('@semaphore-protocol/proof');
	const ok = await verifyProof(proof as unknown as Parameters<typeof verifyProof>[0]);
	if (!ok) throw error(400, 'invalid proof');

	return { snapshot: snap, nullifier: proof.nullifier };
}
