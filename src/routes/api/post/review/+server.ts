import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireRole, ROLES_REVIEWING } from '$lib/server/auth';
import { verifyMembership } from '$lib/server/semaphore';
import { evaluatePostReview } from '$lib/server/tally';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';
import { notifyMembersOfNewPublishedPost } from '$lib/server/notifications';
import { isValidRejectionReason } from '$lib/rejection-reasons';

const ProofSchema = z.object({
	merkleTreeDepth: z.number().int().positive(),
	merkleTreeRoot: z.string(),
	nullifier: z.string(),
	message: z.string(),
	scope: z.string(),
	points: z.array(z.string())
});

const Body = z
	.object({
		post_version_id: z.string().uuid(),
		vote: z.enum(['approve', 'reject']),
		comment: z.string().max(2000).optional(),
		// Required when vote='reject', ignored otherwise. Multi-select from
		// the rejection_reason enum — a post can be both rage_bait AND
		// ai_generated. We validate the strings against the shared catalog
		// instead of letting zod enumerate the union here so the catalog
		// stays the single source of truth.
		rejection_reasons: z
			.array(z.string().refine(isValidRejectionReason, 'unknown rejection reason'))
			.optional(),
		proof: ProofSchema
	})
	.refine((b) => b.vote !== 'reject' || (b.rejection_reasons && b.rejection_reasons.length > 0), {
		message: 'rejection_reasons required when vote=reject',
		path: ['rejection_reasons']
	});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.reviewCast, event, { keyBy: 'user' });
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const versionRows = await db
		.select({
			version: schema.blogPostVersions,
			post: schema.blogPosts
		})
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.blogPostVersions.id, parsed.data.post_version_id))
		.limit(1);
	const row = versionRows[0];
	if (!row) throw error(404, 'post version not found');
	// Voting window: a vote is only accepted while the post is under review.
	// Once it publishes or is rejected the window is closed for everyone.
	if (row.post.status !== 'under_review') throw error(409, 'voting is closed for this post');

	await requireRole(row.post.blogId, locals.user.id, ROLES_REVIEWING);

	const expectedScope = `review:${parsed.data.post_version_id}`;
	const expectedMessage = parsed.data.vote;
	const { snapshot, nullifier } = await verifyMembership({
		blogId: row.post.blogId,
		proof: parsed.data.proof,
		expectedScope,
		expectedMessage,
		// Reviews verify against the current snapshot so the voting population
		// matches the one the tally threshold is computed from (M1). A removed
		// or rotated-away member can no longer vote.
		requireCurrentRoot: true
	});

	// Change-vote (H2): a reviewer may flip their vote while the post is under
	// review. The review nullifier scope is `review:<versionId>`, stable per
	// identity per version, so the same reviewer always yields the same
	// nullifier. The unique key (postVersionId, nullifier) lets us UPSERT and
	// replace their prior vote instead of rejecting it as a duplicate. We also
	// refresh proof + snapshotRoot so the stored row reflects the latest cast.
	const reasons =
		parsed.data.vote === 'reject' && parsed.data.rejection_reasons
			? // Deduplicate the reasons array (a UI bug could resend the same key).
				// `as` cast: zod refined each string to RejectionReasonKey.
				[...new Set(parsed.data.rejection_reasons)]
			: null;
	await db
		.insert(schema.postReviews)
		.values({
			postVersionId: parsed.data.post_version_id,
			vote: parsed.data.vote,
			proof: parsed.data.proof,
			snapshotRoot: snapshot.root,
			nullifier,
			comment: parsed.data.comment ?? null,
			rejectionReasons: reasons as never
		})
		.onConflictDoUpdate({
			target: [schema.postReviews.postVersionId, schema.postReviews.nullifier],
			set: {
				vote: parsed.data.vote,
				proof: parsed.data.proof,
				snapshotRoot: snapshot.root,
				comment: parsed.data.comment ?? null,
				rejectionReasons: reasons as never
			}
		});

	const result = await evaluatePostReview(parsed.data.post_version_id);

	await audit(event, {
		event: 'review.cast',
		// Anonymous content action: record IP/UA but never the acting member.
		anonymous: true,
		subjectBlogId: row.post.blogId,
		metadata: {
			post_id: row.post.id,
			version_id: parsed.data.post_version_id,
			vote: parsed.data.vote,
			rejection_reasons: parsed.data.rejection_reasons ?? null
		}
	});
	// Emit the state-change event for the *moment* the post flipped to a
	// terminal state. evaluatePostReview's status reflects the new state; the
	// previous DB row we read above (row.post.status) tells us it was still
	// under_review when we started.
	if (result.status === 'published') {
		await audit(event, {
			event: 'post.published',
			// Anonymous content action: the deciding vote is the moment a post
			// crosses quorum. Stamping the reviewer who happened to cast it would
			// de-anonymize that vote, so never record the acting member.
			anonymous: true,
			subjectBlogId: row.post.blogId,
			metadata: {
				post_id: row.post.id,
				version_id: parsed.data.post_version_id,
				approves: result.approves,
				rejects: result.rejects,
				threshold: result.threshold
			}
		});
		// Fire-and-forget: email every active member that a new post is live.
		void notifyMembersOfNewPublishedPost(row.post.blogId, parsed.data.post_version_id);
	} else if (result.status === 'rejected') {
		await audit(event, {
			event: 'post.rejected',
			// Anonymous content action: same reasoning as post.published — the
			// reviewer whose vote crossed the reject quorum must never be recorded.
			anonymous: true,
			subjectBlogId: row.post.blogId,
			metadata: {
				post_id: row.post.id,
				version_id: parsed.data.post_version_id,
				approves: result.approves,
				rejects: result.rejects,
				threshold: result.threshold
			}
		});
	}
	return json({ ok: true, ...result });
};
