import { error } from '@sveltejs/kit';
import { getSnapshotByRoot, currentMembership } from '$lib/db/snapshots';
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
//
// `requireCurrentRoot` gates whether a proof against an older (still-known but
// no longer current) snapshot is accepted. Authorship, edits, and reviews set
// it so a removed or rotated-away member can't act on a stale root: the proof
// must match the blog's CURRENT proving-eligible set. Comments leave it off:
// they tolerate any historical snapshot of the same blog.
export async function verifyMembership(opts: {
	blogId: string;
	proof: IncomingProof;
	expectedScope: string;
	expectedMessage: string;
	requireCurrentRoot?: boolean;
}) {
	const { proof, blogId, expectedScope, expectedMessage, requireCurrentRoot } = opts;

	const snap = await getSnapshotByRoot(blogId, proof.merkleTreeRoot);
	if (!snap) throw error(400, 'proof references unknown membership snapshot');

	if (requireCurrentRoot) {
		// Derive the live membership root rather than reading the newest snapshot
		// row: a removed or rotated-away member must fail here, and the root must
		// match the current proving-eligible set even if membership has cycled.
		const current = await currentMembership(blogId);
		if (current.root !== proof.merkleTreeRoot) {
			throw error(400, 'proof root is not the current membership snapshot');
		}
	}

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
