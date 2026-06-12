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
	.refine(
		(b) => b.vote !== 'reject' || (b.rejection_reasons && b.rejection_reasons.length > 0),
		{ message: 'rejection_reasons required when vote=reject', path: ['rejection_reasons'] }
	);

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
	if (row.post.status !== 'under_review') throw error(409, 'post is not under review');

	await requireRole(row.post.blogId, locals.user.id, ROLES_REVIEWING);

	const expectedScope = `review:${parsed.data.post_version_id}`;
	const expectedMessage = parsed.data.vote;
	const { snapshot, nullifier } = await verifyMembership({
		blogId: row.post.blogId,
		proof: parsed.data.proof,
		expectedScope,
		expectedMessage
	});

	try {
		// Deduplicate the reasons array (a UI bug could resend the same key).
		// `as` cast: zod refined each string to RejectionReasonKey.
		const reasons =
			parsed.data.vote === 'reject' && parsed.data.rejection_reasons
				? [...new Set(parsed.data.rejection_reasons)]
				: null;
		await db.insert(schema.postReviews).values({
			postVersionId: parsed.data.post_version_id,
			vote: parsed.data.vote,
			proof: parsed.data.proof,
			snapshotRoot: snapshot.root,
			nullifier,
			comment: parsed.data.comment ?? null,
			rejectionReasons: reasons as never
		});
	} catch (e) {
		const err = e as { code?: string };
		if (err.code === '23505') throw error(409, 'you already voted on this post');
		throw e;
	}

	const result = await evaluatePostReview(parsed.data.post_version_id);

	await audit(event, {
		event: 'review.cast',
		actorUserId: locals.user.id,
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
			actorUserId: locals.user.id,
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
			actorUserId: locals.user.id,
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
