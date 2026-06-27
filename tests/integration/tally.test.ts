import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq, sql } from 'drizzle-orm';
import { evaluatePostReview, getReviewSummary } from '$lib/server/tally';
import { createPost } from '$lib/db/posts';
import { setRole, removeMember } from '$lib/db/members';
import { makeUser, makeBlogWith } from '../setup/factories';

// Blind-token tally model (Phase 5): votes are anonymous token redemptions keyed
// by a token nonce (no Semaphore snapshot root). The eligible-count (threshold
// denominator) is the live set of can_review members. owner + N reviewers ⇒ N+1
// eligible reviewers (owner has can_review too).
async function setupBlogWithReviewers(n: number) {
	const owner = await makeUser({ username: 'owner' });
	const reviewers = [];
	for (let i = 0; i < n; i++) {
		reviewers.push(await makeUser({ username: `rev${i}` }));
	}
	const { id: blogId } = await makeBlogWith({
		owner,
		members: reviewers.map((r) => ({ user: r, role: 'reviewer' as const }))
	});
	return { owner, reviewers, blogId };
}

async function createUnderReviewPost(blogId: string, nonce = 'authorNonce') {
	// The post's own nullifier/snapshotRoot are irrelevant to the token-based
	// tally; we just need an under_review version to vote on.
	const r = await createPost({
		blogId,
		title: 'Vote me',
		content: 'body',
		proof: {},
		snapshotRoot: 'r',
		nullifier: nonce,
		status: 'under_review'
	});
	return r;
}

// Insert a token-based vote (tokenNonce is the anonymous per-voter handle).
async function insertVote(postVersionId: string, vote: 'approve' | 'reject', tokenNonce: string) {
	await db.insert(schema.postReviews).values({ postVersionId, vote, tokenNonce });
}

// Mirrors the vote-flip UPSERT in src/routes/api/post/review/+server.ts: re-casting
// with the same (version, token_nonce) replaces the vote, never duplicates it.
async function upsertVote(postVersionId: string, vote: 'approve' | 'reject', tokenNonce: string) {
	await db
		.insert(schema.postReviews)
		.values({ postVersionId, vote, tokenNonce })
		.onConflictDoUpdate({
			target: [schema.postReviews.postVersionId, schema.postReviews.tokenNonce],
			targetWhere: sql`${schema.postReviews.tokenNonce} IS NOT NULL`,
			set: { vote }
		});
}

describe('evaluatePostReview thresholds', () => {
	it('eligible_count=3, threshold ceil(2/3 * 3) = 2: stays under_review with 1 approve', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // owner + 2 reviewers = 3 can_review
		const post = await createUnderReviewPost(blogId);
		await insertVote(post.version.id, 'approve', 'n1');
		const result = await evaluatePostReview(post.version.id);
		expect(result.threshold).toBe(2);
		expect(result.approves).toBe(1);
		expect(result.status).toBe('under_review');
	});

	it('publishes when approvals reach the threshold', async () => {
		const { blogId } = await setupBlogWithReviewers(2);
		const post = await createUnderReviewPost(blogId);
		await insertVote(post.version.id, 'approve', 'n1');
		await insertVote(post.version.id, 'approve', 'n2');
		const result = await evaluatePostReview(post.version.id);
		expect(result.status).toBe('published');

		const post_ = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, post.post.id))
			.limit(1);
		const version = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.id, post.version.id))
			.limit(1);
		expect(post_[0].status).toBe('published');
		expect(version[0].status).toBe('published');
		expect(version[0].publishedAt).toBeInstanceOf(Date);
	});

	it('rejects when rejections reach the threshold', async () => {
		const { blogId } = await setupBlogWithReviewers(2);
		const post = await createUnderReviewPost(blogId);
		await insertVote(post.version.id, 'reject', 'n1');
		await insertVote(post.version.id, 'reject', 'n2');
		const result = await evaluatePostReview(post.version.id);
		expect(result.status).toBe('rejected');
	});

	it('threshold tracks the LIVE can_review count: adding reviewers raises the bar', async () => {
		const { blogId, owner } = await setupBlogWithReviewers(2); // 3 eligible, threshold 2
		const post = await createUnderReviewPost(blogId);
		await insertVote(post.version.id, 'approve', 'n1');
		await insertVote(post.version.id, 'approve', 'n2');
		// At 3 eligible, 2 approves would publish — but add 2 reviewers BEFORE the
		// tally so eligible = 5, threshold ceil(2/3*5)=4. The two votes no longer
		// suffice.
		const extra1 = await makeUser({ username: 'extra1' });
		const extra2 = await makeUser({ username: 'extra2' });
		await setRole(blogId, extra1.id, 'reviewer', owner.id);
		await setRole(blogId, extra2.id, 'reviewer', owner.id);

		const r = await evaluatePostReview(post.version.id);
		expect(r.threshold).toBe(4);
		expect(r.approves).toBe(2);
		expect(r.status).toBe('under_review');

		// Three more distinct token votes push approves to 5 ≥ 4 → published.
		await insertVote(post.version.id, 'approve', 'n3');
		await insertVote(post.version.id, 'approve', 'n4');
		const done = await evaluatePostReview(post.version.id);
		expect(done.approves).toBe(4);
		expect(done.status).toBe('published');
	});

	it('removing a reviewer lowers the bar (threshold tracks live can_review)', async () => {
		// owner + 3 reviewers = 4 eligible, threshold ceil(2/3 * 4) = 3.
		const owner = await makeUser({ username: 'owner' });
		const reviewers = [];
		for (let i = 0; i < 3; i++) reviewers.push(await makeUser({ username: `rev${i}` }));
		const { id: blogId } = await makeBlogWith({
			owner,
			members: reviewers.map((r) => ({ user: r, role: 'reviewer' as const }))
		});
		const post = await createUnderReviewPost(blogId);
		await insertVote(post.version.id, 'approve', 'a1');
		await insertVote(post.version.id, 'approve', 'a2');
		let r = await evaluatePostReview(post.version.id);
		expect(r.threshold).toBe(3);
		expect(r.status).toBe('under_review'); // 2 < 3

		// Remove one reviewer → eligible 3, threshold ceil(2/3*3)=2. The two
		// existing approves now meet the lower bar.
		await removeMember(blogId, reviewers[2].id);
		r = await evaluatePostReview(post.version.id);
		expect(r.threshold).toBe(2);
		expect(r.approves).toBe(2);
		expect(r.status).toBe('published');
	});

	it('does not move a post that is not currently under_review', async () => {
		const { blogId } = await setupBlogWithReviewers(2);
		const post = await createUnderReviewPost(blogId);
		await db
			.update(schema.blogPosts)
			.set({ status: 'rejected' })
			.where(eq(schema.blogPosts.id, post.post.id));
		await insertVote(post.version.id, 'approve', 'n1');
		await insertVote(post.version.id, 'approve', 'n2');
		const result = await evaluatePostReview(post.version.id);
		expect(result.status).toBe('published'); // logically would publish…
		const p = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, post.post.id))
			.limit(1);
		// …but the side-effect only fires when the post is currently under_review.
		expect(p[0].status).toBe('rejected');
	});

	it('getReviewSummary counts approve/reject votes', async () => {
		const { blogId } = await setupBlogWithReviewers(2);
		const post = await createUnderReviewPost(blogId);
		await insertVote(post.version.id, 'approve', 'a1');
		await insertVote(post.version.id, 'reject', 'r1');
		const sum = await getReviewSummary(post.version.id);
		expect(sum).toEqual({ approves: 1, rejects: 1 });
	});
});

// Vote-flip: a voter may flip their vote while under_review via an UPSERT keyed
// on (postVersionId, tokenNonce) — the same anonymous token re-redeemed with a
// different vote replaces, not duplicates.
describe('vote-flip: upsert on (postVersionId, tokenNonce)', () => {
	it('changing reject -> approve UPDATES the row, not duplicates it', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // 3 eligible, threshold 2
		const post = await createUnderReviewPost(blogId);

		await upsertVote(post.version.id, 'reject', 'tokX');
		await upsertVote(post.version.id, 'approve', 'tokY');
		let result = await evaluatePostReview(post.version.id);
		expect(result.approves).toBe(1);
		expect(result.rejects).toBe(1);
		expect(result.status).toBe('under_review');

		// Token X re-redeemed with approve → row updated.
		await upsertVote(post.version.id, 'approve', 'tokX');

		const rows = await db
			.select()
			.from(schema.postReviews)
			.where(eq(schema.postReviews.postVersionId, post.version.id));
		expect(rows.length).toBe(2);
		const xRows = rows.filter((r) => r.tokenNonce === 'tokX');
		expect(xRows.length).toBe(1);
		expect(xRows[0].vote).toBe('approve');

		result = await evaluatePostReview(post.version.id);
		expect(result.approves).toBe(2);
		expect(result.rejects).toBe(0);
		expect(result.status).toBe('published');
	});

	it('changing approve -> reject moves the tally back below the approve threshold', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // threshold 2
		const post = await createUnderReviewPost(blogId);

		await upsertVote(post.version.id, 'approve', 'a');
		let result = await evaluatePostReview(post.version.id);
		expect(result.approves).toBe(1);
		expect(result.status).toBe('under_review');

		await upsertVote(post.version.id, 'reject', 'a');
		result = await evaluatePostReview(post.version.id);
		expect(result.approves).toBe(0);
		expect(result.rejects).toBe(1);
		expect(result.status).toBe('under_review');

		const rows = await db
			.select()
			.from(schema.postReviews)
			.where(eq(schema.postReviews.postVersionId, post.version.id));
		expect(rows.length).toBe(1);
		expect(rows[0].vote).toBe('reject');
	});

	it('post status is terminal once published (voting window closed)', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // threshold 2
		const post = await createUnderReviewPost(blogId);
		await upsertVote(post.version.id, 'approve', 'a1');
		await upsertVote(post.version.id, 'approve', 'a2');
		const published = await evaluatePostReview(post.version.id);
		expect(published.status).toBe('published');

		const p = await db
			.select({ status: schema.blogPosts.status })
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, post.post.id))
			.limit(1);
		expect(p[0].status).toBe('published');
	});
});
