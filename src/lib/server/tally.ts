import { db, schema } from '$lib/db/client';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { setPostStatus } from '$lib/db/posts';

// Decide whether a post version has crossed approve/reject thresholds.
//
// Blind-token tally (Phase 5): votes are anonymous token redemptions, not
// Semaphore proofs, so there is no snapshot root to anchor to. Instead:
//   - Eligible population = the eligible-reviewer count FROZEN when the version
//     entered under_review (blog_post_versions.eligibleReviewersAtReview), NOT
//     the live can_review count. Freezing the denominator closes the
//     quorum-capture attack where an operator demotes reviewers mid-review to
//     drop the bar below the votes already cast (or below what they can muster).
//     For legacy rows that never recorded a snapshot, we fall back to the live
//     can_review count.
//   - Floor: the denominator is never allowed below the number of tokens already
//     ISSUED for this version. Issuing a token is the participation signal, and
//     a token outstanding is a vote that may still arrive; letting the bar fall
//     under the issued-token count would let a late flurry of approvals (or a
//     shrinking snapshot via some future path) publish on fewer real reviewers
//     than were already invited to vote. max(snapshot, tokensIssued) keeps the
//     bar honest. Counting issuances alone (never joined to post_reviews) does
//     NOT link voters to votes — it is just the count of outstanding tokens.
//   - threshold = ceil(denominator * num / den).
//   - Counted votes = the token-based review rows for this version (one row per
//     redeemed token; vote-flip UPSERTs in place, so each token counts once).
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

	// Denominator: the FROZEN eligible-reviewer count from when this version
	// entered review. Legacy rows (null) fall back to the live can_review count.
	let denominatorPop = row.version.eligibleReviewersAtReview;
	if (denominatorPop == null) {
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
		denominatorPop = eligibleRows.length;
	}

	// Floor the denominator at the number of tokens already issued for this
	// version (outstanding votes that may still land). This is a bare count of
	// vote_token_issuances for the version — NEVER joined to post_reviews, so it
	// reveals no voter↔vote linkage.
	const issuedRows = await db
		.select({ id: schema.voteTokenIssuances.id })
		.from(schema.voteTokenIssuances)
		.where(eq(schema.voteTokenIssuances.postVersionId, postVersionId));
	const tokensIssued = issuedRows.length;
	const eligibleCount = Math.max(denominatorPop, tokensIssued);

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
