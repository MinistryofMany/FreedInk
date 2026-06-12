// Aggregated, anonymous feedback for an author whose post was rejected.
// Returns counts per rejection reason and free-text comments left by
// reviewers (which can be empty). No reviewer identities — authors learn
// the *what* (rage_bait + ai_generated + factual_errors) without learning
// the *who*.
import { db, schema } from './client';
import { eq } from 'drizzle-orm';
import { REJECTION_REASONS, type RejectionReasonKey } from '$lib/rejection-reasons';

export type ReviewFeedback = {
	approves: number;
	rejects: number;
	reasonCounts: Array<{ key: RejectionReasonKey; label: string; count: number }>;
	comments: Array<{ comment: string; vote: 'approve' | 'reject'; createdAt: Date }>;
};

export async function getReviewFeedback(postVersionId: string): Promise<ReviewFeedback> {
	const rows = await db
		.select({
			vote: schema.postReviews.vote,
			rejectionReasons: schema.postReviews.rejectionReasons,
			comment: schema.postReviews.comment,
			createdAt: schema.postReviews.createdAt
		})
		.from(schema.postReviews)
		.where(eq(schema.postReviews.postVersionId, postVersionId));

	const tally = { approves: 0, rejects: 0 };
	const counts = new Map<RejectionReasonKey, number>();
	const comments: ReviewFeedback['comments'] = [];

	for (const r of rows) {
		if (r.vote === 'approve') tally.approves++;
		else tally.rejects++;
		for (const key of r.rejectionReasons ?? []) {
			counts.set(key as RejectionReasonKey, (counts.get(key as RejectionReasonKey) ?? 0) + 1);
		}
		if (r.comment && r.comment.trim().length > 0) {
			comments.push({
				comment: r.comment,
				vote: r.vote,
				createdAt: r.createdAt
			});
		}
	}

	// Preserve the catalog's display order; only emit reasons with > 0 count.
	const reasonCounts = REJECTION_REASONS.flatMap((spec) => {
		const c = counts.get(spec.key);
		return c ? [{ key: spec.key, label: spec.label, count: c }] : [];
	});

	// Newest comments first so authors see the latest reviewer thoughts.
	comments.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

	return { ...tally, reasonCounts, comments };
}
