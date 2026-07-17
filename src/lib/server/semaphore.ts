import { error } from '@sveltejs/kit';
import { membership } from '$lib/db/snapshots';
import type { TreeCapability } from '$lib/db/schema';

export type IncomingProof = {
	merkleTreeDepth: number;
	merkleTreeRoot: string;
	nullifier: string;
	message: string;
	scope: string;
	points: string[];
};

// Verify a Semaphore membership proof FOR THE GIVEN CAPABILITY TREE against the
// snapshot it is bound to, checking the proof's scope/message match what the
// server expected, then the SNARK. Returns { snapshot, nullifier } on success;
// throws SvelteKit 400 errors otherwise. Delegates to @ministryofmany/membership
// (createMembership().verify over FreedInk's provider + persisted snapshot store);
// this wrapper keeps FreedInk's error-string mapping and requireCurrentRoot
// contract.
//
// CRITICAL (design R1 — tree/capability confusion): the Semaphore proof binds a
// Merkle root but NOT which capability tree that root belongs to. The lookup is
// pinned to (blogId, capability, root) inside the store, so a writers-tree member
// can never pass a commenters check and vice-versa. Votes do not call this
// (blind tokens).
//
// R4 (requireCurrentRoot default): FAIL-CLOSED. Under the one-root re-key model
// blog_member_snapshots is append-only and never pruned, so tolerating any
// historical root (the old default) would let a re-keyed-away commitment prove
// membership forever — a bounded per-re-key gain becomes an unbounded cumulative
// one (audit W5). We therefore default to TRUE: a call site that omits the flag
// rejects any root that is not the tree's current live root. Author/edit/comment
// already pass an explicit `true`; the default now matches them.
export async function verifyMembership(opts: {
	blogId: string;
	capability: TreeCapability;
	proof: IncomingProof;
	expectedScope: string;
	expectedMessage: string;
	requireCurrentRoot?: boolean;
}) {
	const { proof, blogId, capability, expectedScope, expectedMessage, requireCurrentRoot } = opts;

	const result = await membership.verify({
		ref: { context: blogId, subTree: capability },
		proof: { kind: 'semaphore', ...proof },
		expectedScope,
		expectedMessage,
		requireCurrentRoot: requireCurrentRoot ?? true
	});

	if (!result.ok) {
		switch (result.reason) {
			case 'unknown-snapshot':
				throw error(400, 'proof references unknown membership snapshot');
			case 'stale-root':
				throw error(400, 'proof root is not the current membership snapshot');
			case 'scope-mismatch':
				throw error(400, 'proof scope mismatch');
			case 'message-mismatch':
				throw error(400, 'proof message mismatch');
			default:
				// invalid-proof / engine-mismatch (the latter cannot occur for a
				// semaphore-only consumer) → the SNARK is invalid or malformed.
				throw error(400, 'invalid proof');
		}
	}

	const snap = result.snapshot;
	return {
		snapshot: {
			id: snap.snapshotId,
			root: snap.root,
			capability: snap.ref.subTree as TreeCapability,
			identities: snap.leaves,
			eligibleCount: snap.eligibleCount
		},
		nullifier: result.nullifier
	};
}
