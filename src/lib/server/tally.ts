import { db, schema } from '$lib/db/client';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { setPostStatus } from '$lib/db/posts';

// Decide whether a post version has crossed approve/reject thresholds.
//
// Blind-token tally (Phase 5): votes are anonymous token redemptions, not
// Semaphore proofs, so there is no snapshot root to anchor to. Instead:
//   - Eligible population = the live set of members with can_review (the people
//     who COULD be issued a token). threshold = ceil(eligibleReviewers*num/den).
//   - Counted votes = the token-based review rows for this version (one row per
//     redeemed token; vote-flip UPSERTs in place, so each token counts once).
// The bar-setting population (eligible reviewers) and the voting population
// (token holders, a subset of eligible reviewers at issue time) align: a token
// is only ever issued to a can_review member.
export async function evaluatePostReview(postVersionId: string): Promise<{
	status: 'under_review' | 'published' | 'rejected';
	approves: number;
	rejects: number;
	threshold: number;
}> {
	const versionRows = await db
		.select({
			version: schema.blogPostVersions,
			post: schema.blogPosts,
			blog: schema.blogs
		})
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.innerJoin(schema.blogs, eq(schema.blogs.id, schema.blogPosts.blogId))
		.where(eq(schema.blogPostVersions.id, postVersionId))
		.limit(1);
	const row = versionRows[0];
	if (!row) throw new Error('post version not found');

	// Eligible reviewers = active members with can_review on this blog.
	const eligibleRows = await db
		.select({ id: schema.blogMembers.id })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, row.post.blogId),
				isNull(schema.blogMembers.removedAt),
				eq(schema.blogMembers.canReview, true)
			)
		);
	const eligibleCount = eligibleRows.length;

	// Count token-based votes for this version (tokenNonce IS NOT NULL). Each
	// redeemed token is one row (vote-flip UPSERTs, so no double-count).
	const reviewRows = await db
		.select({ vote: schema.postReviews.vote })
		.from(schema.postReviews)
		.where(
			and(
				eq(schema.postReviews.postVersionId, postVersionId),
				isNotNull(schema.postReviews.tokenNonce)
			)
		);

	const approves = reviewRows.filter((r) => r.vote === 'approve').length;
	const rejects = reviewRows.filter((r) => r.vote === 'reject').length;

	const num = row.blog.approvalNumerator;
	const den = row.blog.approvalDenominator;
	const threshold = Math.ceil((eligibleCount * num) / den);

	let newStatus: 'under_review' | 'published' | 'rejected' = 'under_review';
	if (approves >= threshold && threshold > 0) newStatus = 'published';
	else if (rejects >= threshold && threshold > 0) newStatus = 'rejected';

	if (newStatus !== 'under_review' && row.post.status === 'under_review') {
		await setPostStatus(row.post.id, row.version.id, newStatus);
	}

	return { status: newStatus, approves, rejects, threshold };
}

export async function getReviewSummary(postVersionId: string) {
	const rows = await db
		.select({ vote: schema.postReviews.vote })
		.from(schema.postReviews)
		.where(eq(schema.postReviews.postVersionId, postVersionId));
	return {
		approves: rows.filter((r) => r.vote === 'approve').length,
		rejects: rows.filter((r) => r.vote === 'reject').length
	};
}
