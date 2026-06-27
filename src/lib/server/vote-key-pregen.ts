// Vote-key pre-generation triggers (avoid the cold-keygen UX wait).
//
// Safe-prime RSA keygen is multi-second; no reviewer should wait on it when they
// click Approve/Reject. We warm the blog's issuer key ahead of the first vote on
// two events (both fire-and-forget, never blocking the triggering request):
//
//   (a) a blog gains its 2nd reviewer-capable member — an early head-start that
//       skips solo / abandoned blogs (a blog with <2 reviewers may never hold a
//       real vote, so we don't pay keygen for it); and
//   (b) a post first enters under_review and no key exists yet — the DEFINITIVE
//       guarantee that covers any edge case the event in (a) misses (e.g. a solo
//       owner who self-approves, or a member-count that crossed 2 while the
//       event hook wasn't reached).
//
// Both delegate to the active VoteSigner's ensureKey(), so the behavior is the
// same in both backends: local = background DB keygen; Signet = async POST /key.
// ensureKey is idempotent (no-op if a key already exists) and best-effort
// (failures are logged, never thrown) — the on-demand path at issuance time
// remains the hard guarantee.

import { getVoteSigner } from './vote-signer';
import { countEligibleReviewers } from '$lib/db/members';
import { log } from './log';

// Number of reviewer-capable members at which we start warming the key. Two is
// the smallest set where an anonymous multi-reviewer vote is meaningful.
const PREGEN_REVIEWER_THRESHOLD = 2;

// Fire pre-gen if the blog now has >= 2 reviewer-capable members. Call AFTER any
// membership / capability change that could grant can_review (accept invite,
// setRole, setCapability, changeCapabilities). Fire-and-forget: returns
// immediately; the keygen runs in the background.
export function pregenOnReviewerAdded(blogId: string): void {
	void (async () => {
		try {
			const count = await countEligibleReviewers(blogId);
			if (count >= PREGEN_REVIEWER_THRESHOLD) {
				await getVoteSigner().ensureKey(blogId);
			}
		} catch (err) {
			log.warn({ err, blogId }, 'pregenOnReviewerAdded failed');
		}
	})();
}

// Fire pre-gen unconditionally because a post just entered under_review (the hard
// guarantee). ensureKey no-ops if a key already exists. Call AFTER the status
// transition commits. Fire-and-forget.
export function pregenOnEnterReview(blogId: string): void {
	void (async () => {
		try {
			await getVoteSigner().ensureKey(blogId);
		} catch (err) {
			log.warn({ err, blogId }, 'pregenOnEnterReview failed');
		}
	})();
}
