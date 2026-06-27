// Phase 5 — blind-signature voting tokens. Exercises the issuance + redemption
// flow against the running server and the auditor-critical invariants:
//   - issuance is can_review-gated (an ineligible user gets no token);
//   - one token per (user, version);
//   - redemption is session-free and anonymous;
//   - a token bound to version A cannot vote on version B (cross-version replay);
//   - double-redeeming the same token is idempotent (vote-flip), never a
//     double-count.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { asUser, postJSON, buildVoteToken, redeemVote } from './helpers';
import { makeUser, makeBlogWith, buildTestProof } from '../setup/factories';

// Create an under_review post in a blog, returning its version id. The owner
// authors it (writers proof, session-free).
async function submitPost(
	blog: { id: string; slug: string },
	owner: { identity: import('@semaphore-protocol/identity').Identity },
	title = 'Token Post'
) {
	const proof = await buildTestProof({
		blogId: blog.id,
		identity: owner.identity,
		scope: `post:${blog.id}`,
		message: `${title}\n\nbody`,
		capability: 'author'
	});
	const res = await postJSON('/api/blog/post', {
		blog_slug: blog.slug,
		title,
		content: 'body',
		proof,
		submit_for_review: true
	});
	if (res.status !== 200) throw new Error(`submit failed ${res.status}: ${await res.text()}`);
	return (await res.json()).version_id as string;
}

describe('vote-token issuance', () => {
	it('issues to a can_review member and records exactly one issuance per (user, version)', async () => {
		const owner = await makeUser({ username: 'vt-owner', seed: 'vt-owner' });
		const reviewer = await makeUser({ username: 'vt-rev', seed: 'vt-rev' });
		const blog = await makeBlogWith({ owner, members: [{ user: reviewer, role: 'reviewer' }] });
		const versionId = await submitPost(blog, owner);

		const revSess = await asUser(reviewer);
		// First issuance succeeds.
		await buildVoteToken(versionId, revSess.cookie);
		// Exactly one issuance row for (version, user).
		const rows = await db
			.select()
			.from(schema.voteTokenIssuances)
			.where(eq(schema.voteTokenIssuances.userId, reviewer.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].postVersionId).toBe(versionId);

		// Second issuance for the same (user, version) is refused.
		await expect(buildVoteToken(versionId, revSess.cookie)).rejects.toThrow(/already been issued/);
	}, 90_000);

	it('refuses issuance to a member without can_review (commenter)', async () => {
		const owner = await makeUser({ username: 'vt-o2', seed: 'vt-o2' });
		const commenter = await makeUser({ username: 'vt-com', seed: 'vt-com' });
		const blog = await makeBlogWith({ owner, members: [{ user: commenter, role: 'commenter' }] });
		const versionId = await submitPost(blog, owner);

		const comSess = await asUser(commenter);
		// The key preflight itself is can_review-gated, so buildVoteToken throws 403.
		await expect(buildVoteToken(versionId, comSess.cookie)).rejects.toThrow();
	}, 90_000);

	it('requires a session to be issued a token (401)', async () => {
		const owner = await makeUser({ username: 'vt-o3', seed: 'vt-o3' });
		const blog = await makeBlogWith({ owner });
		const versionId = await submitPost(blog, owner);
		// No cookie → issuance endpoint 401.
		const res = await postJSON('/api/blog/vote-token', {
			post_version_id: versionId,
			blinded_message: 'AA'
		});
		expect(res.status).toBe(401);
	}, 90_000);
});

describe('vote-token redemption (anonymous)', () => {
	it('redeems a token with NO session and records an anonymous vote', async () => {
		const owner = await makeUser({ username: 'vt-r-o', seed: 'vt-r-o' });
		const reviewer = await makeUser({ username: 'vt-r-rev', seed: 'vt-r-rev' });
		const blog = await makeBlogWith({ owner, members: [{ user: reviewer, role: 'reviewer' }] });
		const versionId = await submitPost(blog, owner);

		const revSess = await asUser(reviewer);
		const token = await buildVoteToken(versionId, revSess.cookie);
		// Redemption sends NO cookie.
		const res = await redeemVote({ versionId, token, vote: 'approve' });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.approves).toBe(1);

		// The stored review row carries a token nonce and NO user link.
		const reviews = await db
			.select()
			.from(schema.postReviews)
			.where(eq(schema.postReviews.postVersionId, versionId));
		expect(reviews).toHaveLength(1);
		expect(reviews[0].tokenNonce).not.toBeNull();
	}, 90_000);

	it('double-redeeming the same token flips the vote (UPSERT), never double-counts', async () => {
		const owner = await makeUser({ username: 'vt-f-o', seed: 'vt-f-o' });
		const reviewer = await makeUser({ username: 'vt-f-rev', seed: 'vt-f-rev' });
		const blog = await makeBlogWith({ owner, members: [{ user: reviewer, role: 'reviewer' }] });
		const versionId = await submitPost(blog, owner);

		const revSess = await asUser(reviewer);
		const token = await buildVoteToken(versionId, revSess.cookie);

		const a = await redeemVote({ versionId, token, vote: 'approve' });
		expect((await a.json()).approves).toBe(1);
		// Same token, flip to reject.
		const b = await redeemVote({
			versionId,
			token,
			vote: 'reject',
			rejectionReasons: ['off_topic']
		});
		const bj = await b.json();
		expect(bj.approves).toBe(0);
		expect(bj.rejects).toBe(1);
		// Exactly one review row (UPSERT, not a second insert).
		const reviews = await db
			.select()
			.from(schema.postReviews)
			.where(eq(schema.postReviews.postVersionId, versionId));
		expect(reviews).toHaveLength(1);
	}, 90_000);

	it('rejects a token signed for a DIFFERENT version (cross-version replay)', async () => {
		const owner = await makeUser({ username: 'vt-x-o', seed: 'vt-x-o' });
		const reviewer = await makeUser({ username: 'vt-x-rev', seed: 'vt-x-rev' });
		const blog = await makeBlogWith({ owner, members: [{ user: reviewer, role: 'reviewer' }] });
		const v1 = await submitPost(blog, owner, 'Post One');
		const v2 = await submitPost(blog, owner, 'Post Two');

		const revSess = await asUser(reviewer);
		// Token issued for v1.
		const tokenForV1 = await buildVoteToken(v1, revSess.cookie);
		// Try to redeem it against v2 — the public metadata (version_id) binds the
		// signature, so verification fails → 400. The vote is NOT recorded on v2.
		const res = await redeemVote({ versionId: v2, token: tokenForV1, vote: 'approve' });
		expect(res.status).toBe(400);
		const reviews = await db
			.select()
			.from(schema.postReviews)
			.where(eq(schema.postReviews.postVersionId, v2));
		expect(reviews).toHaveLength(0);
	}, 120_000);

	it('rejects a garbage signature (400)', async () => {
		const owner = await makeUser({ username: 'vt-g-o', seed: 'vt-g-o' });
		const reviewer = await makeUser({ username: 'vt-g-rev', seed: 'vt-g-rev' });
		const blog = await makeBlogWith({ owner, members: [{ user: reviewer, role: 'reviewer' }] });
		const versionId = await submitPost(blog, owner);
		const res = await redeemVote({
			versionId,
			token: { signature: 'AAAA', preparedNonce: 'AAAA' },
			vote: 'approve'
		});
		expect(res.status).toBe(400);
	}, 90_000);
});
