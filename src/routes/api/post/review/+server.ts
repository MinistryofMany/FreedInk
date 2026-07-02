import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { db, schema } from '$lib/db/client';
import { eq, sql } from 'drizzle-orm';
import { evaluatePostReview } from '$lib/server/tally';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';
import { notifyMembersOfNewPublishedPost } from '$lib/server/notifications';
import { isValidRejectionReason } from '$lib/rejection-reasons';
import { verifyToken } from '@ministryofmany/blind-token/server';
import { getVoteSigner, voteActionInfo } from '$lib/server/vote-signer';
import { isUniqueViolation } from '$lib/server/db-errors';

const Body = z
	.object({
		post_version_id: z.string().uuid(),
		vote: z.enum(['approve', 'reject']),
		comment: z.string().max(2000).optional(),
		// Required when vote='reject'. Multi-select; validated against the catalog.
		rejection_reasons: z
			.array(z.string().refine(isValidRejectionReason, 'unknown rejection reason'))
			.optional(),
		// Blind-token redemption (Phase 5): the unblinded signature, the prepared
		// nonce bytes that were signed, both base64url. No session, no proof.
		signature: z.string().min(1),
		prepared_nonce: z.string().min(1)
	})
	.refine((b) => b.vote !== 'reject' || (b.rejection_reasons && b.rejection_reasons.length > 0), {
		message: 'rejection_reasons required when vote=reject',
		path: ['rejection_reasons']
	});

function b64urlToBytes(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64'));
}

// REDEEM a vote token (the vote). SESSION-FREE and anonymous: authorization is a
// valid blind-token signature over (version_id metadata, prepared nonce). The
// token nonce is the anonymous per-voter-per-version handle that replaces the old
// Semaphore review nullifier:
//   - vote-flip: re-submitting the same (version, token_nonce) with a different
//     vote UPSERTs the stored vote.
//   - double-spend: unique (post_version_id, token_nonce) blocks a second,
//     different nonce... no — blocks reusing the SAME token twice with conflicting
//     intent only via UPSERT; a DIFFERENT nonce is a different token (one per
//     user per version at issuance), so a user can't get two nonces for one
//     version. The unique index makes redemption idempotent per token.
export const POST: RequestHandler = async (event) => {
	// Session-free: rate-limit by IP.
	await enforce(RULES.reviewCast, event, { keyBy: 'ip' });
	const { request } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const versionRows = await db
		.select({ version: schema.blogPostVersions, post: schema.blogPosts })
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.blogPostVersions.id, parsed.data.post_version_id))
		.limit(1);
	const row = versionRows[0];
	if (!row) throw error(404, 'post version not found');
	// Voting window: only while under review.
	if (row.post.status !== 'under_review') throw error(409, 'voting is closed for this post');

	// Verify the blind-token signature over (version metadata, prepared nonce)
	// against the blog's issuer public key. A token signed for a different version
	// fails here (the version_id is the public metadata) — no cross-version replay.
	// The public key comes from the VoteSigner: local mode reads blog_vote_token_keys;
	// Signet mode fetches GET /key (and caches it). Verification is otherwise
	// IDENTICAL to before — the wire scheme is unchanged regardless of backend.
	const pk = await getVoteSigner().getPublicKey(row.post.blogId);
	// `pending` (Signet keygen in flight) means no key exists yet, so no valid token
	// could have been signed — treat exactly like a missing key (invalid token).
	if (pk.status === 'pending') throw error(400, 'invalid vote token');
	const publicKeySpki = pk.publicKeySpki;
	const signature = b64urlToBytes(parsed.data.signature);
	const preparedNonce = b64urlToBytes(parsed.data.prepared_nonce);
	const ok = await verifyToken({
		publicKeySpki,
		signature,
		preparedNonce,
		info: voteActionInfo(parsed.data.post_version_id)
	});
	if (!ok) throw error(400, 'invalid vote token');

	// The token nonce = SHA-256 of the prepared bytes (hex). This is the anonymous
	// per-(voter, version) handle; we never store the signature or the raw bytes.
	const tokenNonce = createHash('sha256').update(preparedNonce).digest('hex');

	const reasons =
		parsed.data.vote === 'reject' && parsed.data.rejection_reasons
			? [...new Set(parsed.data.rejection_reasons)]
			: null;

	try {
		await db
			.insert(schema.postReviews)
			.values({
				postVersionId: parsed.data.post_version_id,
				vote: parsed.data.vote,
				tokenNonce,
				comment: parsed.data.comment ?? null,
				rejectionReasons: reasons as never
			})
			.onConflictDoUpdate({
				// Vote-flip: same (version, token_nonce) UPSERTs the vote. The unique
				// index is PARTIAL (token_nonce IS NOT NULL) — legacy rows have a null
				// nonce — so the ON CONFLICT target must repeat that predicate.
				target: [schema.postReviews.postVersionId, schema.postReviews.tokenNonce],
				targetWhere: sql`${schema.postReviews.tokenNonce} IS NOT NULL`,
				set: {
					vote: parsed.data.vote,
					comment: parsed.data.comment ?? null,
					rejectionReasons: reasons as never
				}
			});
	} catch (e) {
		if (isUniqueViolation(e)) throw error(409, 'duplicate vote (token reuse)');
		throw e;
	}

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

	if (result.status === 'published') {
		await audit(event, {
			event: 'post.published',
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
		void notifyMembersOfNewPublishedPost(row.post.blogId, parsed.data.post_version_id);
	} else if (result.status === 'rejected') {
		await audit(event, {
			event: 'post.rejected',
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
