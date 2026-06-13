import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { evaluatePostReview, getReviewSummary } from '$lib/server/tally';
import { refreshSnapshot, currentMembership } from '$lib/db/snapshots';
import { createPost } from '$lib/db/posts';
import { setRole, removeMember } from '$lib/db/members';
import { makeUser, makeBlogWith } from '../setup/factories';

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

async function createUnderReviewPost(blogId: string, nullifier = 'n') {
	const snap = await refreshSnapshot(blogId);
	const r = await createPost({
		blogId,
		title: 'Vote me',
		content: 'body',
		proof: {},
		snapshotRoot: snap.root,
		nullifier,
		status: 'under_review'
	});
	return r;
}

async function insertReview(
	postVersionId: string,
	snapshotRoot: string,
	vote: 'approve' | 'reject',
	nullifier: string
) {
	await db.insert(schema.postReviews).values({
		postVersionId,
		vote,
		proof: {},
		snapshotRoot,
		nullifier
	});
}

// Mirrors the change-vote (H2) UPSERT in src/routes/api/post/review/+server.ts.
// The review nullifier scope is stable per identity per version, so a reviewer
// re-casting yields the same nullifier and replaces (not duplicates) their row.
async function upsertReview(
	postVersionId: string,
	snapshotRoot: string,
	vote: 'approve' | 'reject',
	nullifier: string
) {
	await db
		.insert(schema.postReviews)
		.values({ postVersionId, vote, proof: {}, snapshotRoot, nullifier })
		.onConflictDoUpdate({
			target: [schema.postReviews.postVersionId, schema.postReviews.nullifier],
			set: { vote, proof: {}, snapshotRoot }
		});
}

describe('evaluatePostReview thresholds', () => {
	it('eligible_count=3, threshold ceil(2/3 * 3) = 2: stays under_review with 1 approve', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // owner + 2 reviewers = 3 proving members
		const post = await createUnderReviewPost(blogId);
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n1');
		const result = await evaluatePostReview(post.version.id);
		expect(result.threshold).toBe(2);
		expect(result.approves).toBe(1);
		expect(result.status).toBe('under_review');
	});

	it('publishes when approvals reach the threshold', async () => {
		const { blogId } = await setupBlogWithReviewers(2);
		const post = await createUnderReviewPost(blogId);
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n1');
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n2');
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
		await insertReview(post.version.id, post.version.snapshotRoot!, 'reject', 'n1');
		await insertReview(post.version.id, post.version.snapshotRoot!, 'reject', 'n2');
		const result = await evaluatePostReview(post.version.id);
		expect(result.status).toBe('rejected');
	});

	it('uses the CURRENT snapshot eligible_count (M1), not the post-time count', async () => {
		const { blogId, owner } = await setupBlogWithReviewers(2); // 3 eligible
		const post = await createUnderReviewPost(blogId);
		// Two reviewers vote under the post-time snapshot (3 eligible, threshold 2).
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n1');
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n2');

		// Now membership changes: add 2 reviewers, rolling the current snapshot
		// forward to 5 eligible. Under M1 the tally anchors to the CURRENT
		// snapshot, so the threshold becomes ceil(2/3 * 5) = 4, and the two
		// stale-root votes no longer count against the new root.
		const extra1 = await makeUser({ username: 'extra1' });
		const extra2 = await makeUser({ username: 'extra2' });
		await setRole(blogId, extra1.id, 'reviewer', owner.id);
		await setRole(blogId, extra2.id, 'reviewer', owner.id);

		const stale = await evaluatePostReview(post.version.id);
		expect(stale.threshold).toBe(4);
		// The old-root approvals don't count against the current root.
		expect(stale.approves).toBe(0);
		expect(stale.status).toBe('under_review');

		// Reviewers re-cast against the new current root. Fetch it.
		const current = await currentMembership(blogId);
		await insertReview(post.version.id, current.root, 'approve', 'c1');
		await insertReview(post.version.id, current.root, 'approve', 'c2');
		await insertReview(post.version.id, current.root, 'approve', 'c3');
		const partial = await evaluatePostReview(post.version.id);
		expect(partial.approves).toBe(3);
		expect(partial.status).toBe('under_review'); // 3 < 4
		await insertReview(post.version.id, current.root, 'approve', 'c4');
		const done = await evaluatePostReview(post.version.id);
		expect(done.approves).toBe(4);
		expect(done.status).toBe('published');
	});

	it('counts only same-current-root votes; stale-root votes are ignored', async () => {
		// owner + 3 reviewers = 4 eligible, threshold ceil(2/3 * 4) = 3.
		const owner = await makeUser({ username: 'owner' });
		const reviewers = [];
		for (let i = 0; i < 3; i++) reviewers.push(await makeUser({ username: `rev${i}` }));
		const { id: blogId } = await makeBlogWith({
			owner,
			members: reviewers.map((r) => ({ user: r, role: 'reviewer' as const }))
		});
		const post = await createUnderReviewPost(blogId);
		const staleRoot = post.version.snapshotRoot!;
		// Two votes under the post-time root.
		await insertReview(post.version.id, staleRoot, 'approve', 'old1');
		await insertReview(post.version.id, staleRoot, 'approve', 'old2');

		// Remove one reviewer → genuinely smaller identity set → a NEW, distinct
		// current root. eligible drops to 3, threshold ceil(2/3 * 3) = 2.
		await removeMember(blogId, reviewers[2].id);

		const current = await currentMembership(blogId);
		expect(current.root).not.toBe(staleRoot);
		expect(current.eligibleCount).toBe(3);

		// The two stale votes do not count; only current-root votes do.
		const stale = await evaluatePostReview(post.version.id);
		expect(stale.approves).toBe(0);
		expect(stale.threshold).toBe(2);
		expect(stale.status).toBe('under_review');

		await insertReview(post.version.id, current!.root, 'approve', 'cur1');
		const mid = await evaluatePostReview(post.version.id);
		expect(mid.approves).toBe(1);
		expect(mid.status).toBe('under_review');

		await insertReview(post.version.id, current!.root, 'approve', 'cur2');
		const done = await evaluatePostReview(post.version.id);
		expect(done.approves).toBe(2);
		expect(done.status).toBe('published');
	});

	it('does not move a post that is not currently under_review', async () => {
		const { blogId } = await setupBlogWithReviewers(2);
		const post = await createUnderReviewPost(blogId);
		await db
			.update(schema.blogPosts)
			.set({ status: 'rejected' })
			.where(eq(schema.blogPosts.id, post.post.id));
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n1');
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n2');
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
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'a1');
		await insertReview(post.version.id, post.version.snapshotRoot!, 'reject', 'r1');
		const sum = await getReviewSummary(post.version.id);
		expect(sum).toEqual({ approves: 1, rejects: 1 });
	});
});

// H2 (change vote): a reviewer may flip their vote while under_review via an
// UPSERT keyed on (postVersionId, nullifier). These tests exercise the same DB
// operation the review endpoint performs and confirm the tally recomputes. The
// endpoint's status-gated voting window (reject when status != under_review) is
// covered by the API-layer flow test.
describe('change vote (H2): upsert on (postVersionId, nullifier)', () => {
	it('changing reject -> approve UPDATES the row, not duplicates it', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // 3 eligible, threshold 2
		const post = await createUnderReviewPost(blogId);
		const root = post.version.snapshotRoot!;

		// Reviewer X casts reject, reviewer Y casts approve.
		await upsertReview(post.version.id, root, 'reject', 'nullX');
		await upsertReview(post.version.id, root, 'approve', 'nullY');
		let result = await evaluatePostReview(post.version.id);
		expect(result.approves).toBe(1);
		expect(result.rejects).toBe(1);
		expect(result.status).toBe('under_review');

		// Reviewer X re-casts the SAME nullifier with approve → row is updated.
		await upsertReview(post.version.id, root, 'approve', 'nullX');

		// Still exactly two rows for this version (no duplicate from the re-cast).
		const rows = await db
			.select()
			.from(schema.postReviews)
			.where(eq(schema.postReviews.postVersionId, post.version.id));
		expect(rows.length).toBe(2);
		const xRows = rows.filter((r) => r.nullifier === 'nullX');
		expect(xRows.length).toBe(1);
		expect(xRows[0].vote).toBe('approve');

		// Tally now reflects the flip: 2 approves >= threshold 2 → published.
		result = await evaluatePostReview(post.version.id);
		expect(result.approves).toBe(2);
		expect(result.rejects).toBe(0);
		expect(result.status).toBe('published');
	});

	it('changing approve -> reject moves the tally back below the approve threshold', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // threshold 2
		const post = await createUnderReviewPost(blogId);
		const root = post.version.snapshotRoot!;

		await upsertReview(post.version.id, root, 'approve', 'a');
		let result = await evaluatePostReview(post.version.id);
		expect(result.approves).toBe(1);
		expect(result.status).toBe('under_review');

		// Same reviewer flips to reject. Approves drop to 0; one reject is not
		// yet the reject threshold (2), so it stays under review.
		await upsertReview(post.version.id, root, 'reject', 'a');
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

	// Voting window: once a post leaves under_review the endpoint rejects any
	// vote (status != under_review → 409). The endpoint reads blog_posts.status
	// before doing anything else; here we assert that the guard's signal (the
	// post status) is terminal after publish, so the endpoint short-circuits.
	it('post status is terminal once published (voting window closed)', async () => {
		const { blogId } = await setupBlogWithReviewers(2); // threshold 2
		const post = await createUnderReviewPost(blogId);
		const root = post.version.snapshotRoot!;
		await upsertReview(post.version.id, root, 'approve', 'a1');
		await upsertReview(post.version.id, root, 'approve', 'a2');
		const published = await evaluatePostReview(post.version.id);
		expect(published.status).toBe('published');

		const p = await db
			.select({ status: schema.blogPosts.status })
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, post.post.id))
			.limit(1);
		// The endpoint's voting-window guard keys on this value being
		// 'under_review'; published is terminal, so a later vote is rejected.
		expect(p[0].status).toBe('published');
	});
});
