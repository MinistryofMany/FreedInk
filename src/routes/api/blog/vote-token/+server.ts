import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireCapability } from '$lib/server/auth';
import { enforce, RULES } from '$lib/server/rate-limit';
import { recordIssuance, releaseIssuance } from '$lib/db/vote-tokens';
import { getVoteSigner } from '$lib/server/vote-signer';
import { log } from '$lib/server/log';

const Body = z.object({
	post_version_id: z.string().uuid(),
	// base64url of the client's blinded message bytes (output of suite.blind()).
	blinded_message: z.string().min(1)
});

function b64urlToBytes(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64'));
}

// Issue ONE blind-signed vote token to the caller for a post version.
//
// AUTHENTICATED (this is the only step that reveals participation): the caller
// must be a member with can_review on the blog, and must not already have been
// issued a token for this version. The signer blind-signs over (version_id
// metadata, blinded nonce) — it never sees the unblinded nonce, so it cannot
// link this issuance to the eventual vote. One token per (user, version) is
// enforced by the unique index on vote_token_issuances (defense in depth in BOTH
// backends; in Signet mode the signer ALSO enforces the same cap independently).
//
// We record the issuance FIRST (atomic one-per-(user,version) guard) and only
// sign if it was newly recorded, so two concurrent requests can never both
// receive a token.
//
// PENDING path (async pre-gen): if the signer reports the key is still being
// generated (Signet keygen in flight), we ROLL BACK the just-recorded issuance
// and return 202 so the client shows "preparing voting…" and retries — the user
// must not burn their single token on a not-ready key.
export const POST: RequestHandler = async (event) => {
	await enforce(RULES.reviewCast, event, { keyBy: 'user' });
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	// Resolve the version + its blog; voting must be open.
	const rows = await db
		.select({ version: schema.blogPostVersions, post: schema.blogPosts })
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.blogPostVersions.id, parsed.data.post_version_id))
		.limit(1);
	const row = rows[0];
	if (!row) throw error(404, 'post version not found');
	if (row.post.status !== 'under_review') throw error(409, 'voting is closed for this post');

	// Eligibility: must hold can_review on the blog. Removing can_review before
	// issuance means no token (the auditor invariant: never sign for an
	// ineligible user). Kept in BOTH backends — defense in depth.
	await requireCapability(row.post.blogId, locals.user.id, 'review');

	// One token per (user, version): record FIRST. If already issued, refuse.
	const fresh = await recordIssuance({
		blogId: row.post.blogId,
		postVersionId: parsed.data.post_version_id,
		userId: locals.user.id
	});
	if (!fresh) throw error(409, 'a vote token has already been issued to you for this version');

	const signer = getVoteSigner();
	const blindedMessage = b64urlToBytes(parsed.data.blinded_message);

	let outcome: Awaited<ReturnType<typeof signer.sign>>;
	try {
		outcome = await signer.sign({
			blogId: row.post.blogId,
			participantId: locals.user.id,
			versionId: parsed.data.post_version_id,
			blindedMessage
		});
	} catch (err) {
		// A transport/transient failure (e.g. Signet unreachable) must not burn the
		// user's single token. Roll back the reservation so they can retry. A
		// malformed-blinded-message error from the signer is also rolled back: the
		// client must resend a well-formed message, which it can only do with a
		// fresh issuance attempt.
		await releaseIssuance({
			postVersionId: parsed.data.post_version_id,
			userId: locals.user.id
		});
		// Local mode treats a thrown sign as a client error (bad blinded message);
		// Signet transport errors are 502. We can't always distinguish, so surface a
		// 400 for the local in-process signer (matches prior behavior) and 502 when
		// the configured backend is Signet.
		if (signer.backend === 'signet') {
			log.warn({ err, blogId: row.post.blogId }, 'signet sign failed; issuance rolled back');
			throw error(502, 'vote signer is unavailable, please try again');
		}
		throw error(400, 'invalid blinded message');
	}

	if (outcome.status === 'pending') {
		// Key not ready yet. Roll back so the token isn't consumed, and tell the
		// client to retry (the review page shows "preparing voting for this post…").
		await releaseIssuance({
			postVersionId: parsed.data.post_version_id,
			userId: locals.user.id
		});
		// Trigger pre-gen as a side effect of the request (signer.sign already does
		// for Signet); return 202 with a hint body the client polls on.
		return json({ status: 'pending' }, { status: 202 });
	}

	if (outcome.status === 'rate_limited') {
		// Signet's per-participant / global ceiling fired. Roll back so the user can
		// retry after the window; surface 429.
		await releaseIssuance({
			postVersionId: parsed.data.post_version_id,
			userId: locals.user.id
		});
		throw error(429, 'too many token requests, please slow down');
	}

	// Success. Return the blind signature unchanged + the public key so a fresh
	// client can finalize without a second round-trip. The public key is sourced
	// via the signer (local DB or Signet GET /key).
	const pk = await signer.getPublicKey(row.post.blogId);
	if (pk.status === 'pending') {
		// Extremely unlikely (we just signed, so the key is ready), but stay safe:
		// don't roll back a successful sign; just omit the key and let the client
		// re-fetch it via the key preflight endpoint.
		return json({
			blind_signature: Buffer.from(outcome.blindSignature).toString('base64url')
		});
	}
	return json({
		blind_signature: Buffer.from(outcome.blindSignature).toString('base64url'),
		public_key: Buffer.from(pk.publicKeySpki).toString('base64url')
	});
};
