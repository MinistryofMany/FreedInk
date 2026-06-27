import { error } from '@sveltejs/kit';
import { getSnapshotByRoot, currentMembership } from '$lib/db/snapshots';
import { hashToField } from '$lib/utils';
import type { TreeCapability } from '$lib/db/schema';

export type IncomingProof = {
	merkleTreeDepth: number;
	merkleTreeRoot: string;
	nullifier: string;
	message: string;
	scope: string;
	points: string[];
};

// Look up the snapshot the proof is bound to FOR THE GIVEN CAPABILITY TREE,
// verify the proof's scope and signal match what the server expected, then
// verify the SNARK. Returns {snapshot, nullifier} on success; throws SvelteKit
// errors otherwise.
//
// CRITICAL (design R1 — tree/capability confusion): the Semaphore proof binds a
// Merkle root but NOT which capability tree that root belongs to. The server
// MUST pin the lookup to (blogId, capability, root). A writers-tree member must
// never pass a commenters check and vice-versa. The `capability` argument is the
// single highest-value authorization input here; every caller passes the
// capability the action requires (author → writers tree, comment → commenters
// tree). Votes do not call this at all (blind tokens).
//
// `requireCurrentRoot` gates whether a proof against an older (still-known but no
// longer current) snapshot of THE SAME TREE is accepted. Authorship and edits
// set it so a removed/rotated-away member can't act on a stale writers root.
// Comments may set it too (design R3/D11) to kill the stale-comment-after-revoke
// vector. When off, any historical snapshot of the same (blog, capability) is
// tolerated — never a different capability's root.
export async function verifyMembership(opts: {
	blogId: string;
	capability: TreeCapability;
	proof: IncomingProof;
	expectedScope: string;
	expectedMessage: string;
	requireCurrentRoot?: boolean;
}) {
	const { proof, blogId, capability, expectedScope, expectedMessage, requireCurrentRoot } = opts;

	const snap = await getSnapshotByRoot(blogId, capability, proof.merkleTreeRoot);
	if (!snap) throw error(400, 'proof references unknown membership snapshot');

	if (requireCurrentRoot) {
		// Derive the live membership root for THIS capability tree rather than
		// reading the newest snapshot row: a removed or rotated-away member must
		// fail here, and the root must match the current eligible set of this exact
		// tree even if membership has cycled.
		const current = await currentMembership(blogId, capability);
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
