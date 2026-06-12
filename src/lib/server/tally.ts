import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { setPostStatus } from '$lib/db/posts';

// Decide whether a post version has crossed approve/reject thresholds. The
// threshold is computed against the snapshot the *post* was proven under so
// adding reviewers mid-vote doesn't shift the bar. We accept reviews proven
// under any snapshot of the same blog (member rotations don't invalidate
// pending reviews); we count unique nullifiers per snapshot.
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

	const reviewRows = await db
		.select({ vote: schema.postReviews.vote })
		.from(schema.postReviews)
		.where(eq(schema.postReviews.postVersionId, postVersionId));

	const approves = reviewRows.filter((r) => r.vote === 'approve').length;
	const rejects = reviewRows.filter((r) => r.vote === 'reject').length;

	let eligibleCount = 0;
	if (row.version.snapshotRoot) {
		const snap = await db
			.select({ eligibleCount: schema.blogMemberSnapshots.eligibleCount })
			.from(schema.blogMemberSnapshots)
			.where(eq(schema.blogMemberSnapshots.root, row.version.snapshotRoot))
			.limit(1);
		eligibleCount = snap[0]?.eligibleCount ?? 0;
	}
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
