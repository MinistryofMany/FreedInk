import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { evaluatePostReview, getReviewSummary } from '$lib/server/tally';
import { refreshSnapshot } from '$lib/db/snapshots';
import { createPost } from '$lib/db/posts';
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

	it('uses the snapshot eligible_count, not the live member count', async () => {
		const { blogId, owner } = await setupBlogWithReviewers(2); // 3 eligible
		const post = await createUnderReviewPost(blogId);
		// Add 2 more reviewers AFTER the post was submitted (fresh snapshots
		// roll forward, but the post's snapshot stays anchored at 3).
		const extra1 = await makeUser({ username: 'extra1' });
		const extra2 = await makeUser({ username: 'extra2' });
		const { setRole } = await import('$lib/db/members');
		await setRole(blogId, extra1.id, 'reviewer', owner.id);
		await setRole(blogId, extra2.id, 'reviewer', owner.id);

		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n1');
		await insertReview(post.version.id, post.version.snapshotRoot!, 'approve', 'n2');
		const result = await evaluatePostReview(post.version.id);
		// Threshold at snapshot time was ceil(2/3 * 3) = 2; with 2 approvals → published.
		// If we'd used live count (5), threshold would be ceil(2/3 * 5) = 4 and it'd still be under review.
		expect(result.threshold).toBe(2);
		expect(result.status).toBe('published');
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
