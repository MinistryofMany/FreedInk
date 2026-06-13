import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { setPostStatus } from '$lib/db/posts';
import { currentMembership } from '$lib/db/snapshots';

// Decide whether a post version has crossed approve/reject thresholds.
//
// Tally consistency (M1): the population that *sets* the bar and the population
// that *votes* must be the same snapshot. We anchor everything to the blog's
// CURRENT snapshot:
//   - threshold = ceil(currentSnapshot.eligibleCount * num / den)
//   - count only review rows whose snapshotRoot == the current root
// Reviews are proven against the current root at cast time (see the review
// endpoint). If membership changes mid-review the current root rolls forward;
// stale-root votes simply stop counting and reviewers re-cast against the new
// root. That's acceptable and avoids the cross-snapshot mismatch where the bar
// was set by one population and met by another.
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

	// Anchor to the blog's live membership (the current root), derived the same
	// way the client and the review endpoint derive it - not the newest snapshot
	// row, which can be stale if membership has cycled.
	const current = await currentMembership(row.post.blogId);
	const currentRoot = current.root;
	const eligibleCount = current.eligibleCount;

	// Count only votes proven against the current root, so the voting
	// population matches the population the threshold is computed from.
	const reviewRows = await db
		.select({ vote: schema.postReviews.vote })
		.from(schema.postReviews)
		.where(
			and(
				eq(schema.postReviews.postVersionId, postVersionId),
				eq(schema.postReviews.snapshotRoot, currentRoot)
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
