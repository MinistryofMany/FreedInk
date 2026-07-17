// The per-blog leaf enroll/replace decision (C1). Pure and side-effect-free so it
// can be exercised in isolation and so the production endpoint and its test share
// the EXACT same rule. The authority is the user's server-verified Ministry epoch
// (`users.anonEpoch`, snapshotted from the id_token at login); a bare commitment
// mismatch is never a re-key trigger.

export type LeafEnrollDecision =
	| { action: 'noop' } // the leaf already holds this commitment
	| { action: 'insert' } // first enrollment for this (user, blog)
	| { action: 'replace' } // re-key: the signed epoch strictly advanced
	| { action: 'reject'; reason: 'no-epoch' | 'stale-epoch' };

export function decideLeafEnroll(input: {
	/** The existing active leaf's commitment, or null when none is enrolled. */
	currentIdc: string | null;
	/** The epoch the existing leaf was last keyed at (row.anonEpoch), or null. */
	currentEpoch: number | null;
	/** The commitment the client wants to enroll. */
	newIdc: string;
	/** The user's authoritative Ministry epoch (users.anonEpoch), or null. */
	tokenEpoch: number | null;
}): LeafEnrollDecision {
	// No authoritative epoch means the user has never completed a Ministry login
	// carrying the claim — fail closed rather than enroll an unversioned leaf.
	if (input.tokenEpoch === null) return { action: 'reject', reason: 'no-epoch' };
	// First enrollment for this (user, blog).
	if (input.currentIdc === null) return { action: 'insert' };
	// Idempotent: the leaf already holds this exact commitment (every device of a
	// user derives the same per-blog commitment). Reads as success, no write.
	if (input.currentIdc === input.newIdc) return { action: 'noop' };
	// A genuine replacement is honored ONLY when the signed epoch strictly advanced
	// past the epoch this leaf was keyed at. This is what stops an attacker looping
	// leaf replacements to mint fresh RLN nullifiers, and a stale device clobbering
	// a freshly re-keyed commitment with an old one.
	if (input.tokenEpoch <= (input.currentEpoch ?? 0)) {
		return { action: 'reject', reason: 'stale-epoch' };
	}
	return { action: 'replace' };
}
