import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireCapability } from '$lib/server/auth';
import { enforce, RULES } from '$lib/server/rate-limit';
import { getVoteIssuer, getVoteSigner, voteActionInfo } from '$lib/server/vote-signer';
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
// enforced by the Issuer's IssuanceStore (the unique index on
// vote_token_issuances; in Signet mode the signer ALSO enforces it independently).
//
// The record-first → sign → rollback-on-failure guard now lives in the package's
// Issuer (@ministryofmany/blind-token): a token is issued IFF a fresh reservation
// was made AND signing returned ok; every other outcome rolls the reservation
// back so the user can retry without burning their single token. This route keeps
// the FreedInk-specific auth, rate-limit, under_review gate, and HTTP mapping.
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

	const blindedMessage = b64urlToBytes(parsed.data.blinded_message);
	const result = await getVoteIssuer().issue({
		group: row.post.blogId,
		participant: locals.user.id,
		info: voteActionInfo(parsed.data.post_version_id),
		blindedMessage
	});

	switch (result.status) {
		case 'issued': {
			// Return the blind signature unchanged + the public key (when available)
			// so a fresh client can finalize without a second round-trip. A pending
			// public key here is extremely unlikely (we just signed) — the Issuer
			// omits it in that case and the client re-fetches via the key preflight.
			const body: { blind_signature: string; public_key?: string } = {
				blind_signature: Buffer.from(result.blindSignature).toString('base64url')
			};
			if (result.publicKeySpki) {
				body.public_key = Buffer.from(result.publicKeySpki).toString('base64url');
			}
			return json(body);
		}
		case 'already_issued':
			throw error(409, 'a vote token has already been issued to you for this version');
		case 'pending':
			// Key not ready yet (Signet keygen). The reservation was rolled back, so
			// no token was consumed; the review page shows "preparing voting…".
			return json({ status: 'pending' }, { status: 202 });
		case 'rate_limited':
			// Signet's per-participant / global ceiling fired; the reservation was
			// rolled back so the user can retry after the window.
			throw error(429, 'too many token requests, please slow down');
		case 'signer_error':
			// The Issuer rolled the reservation back. Local mode treats a thrown sign
			// as a client error (bad blinded message → 400); a Signet transport
			// failure is 502.
			if (getVoteSigner().backend === 'remote') {
				log.warn(
					{ err: result.error, blogId: row.post.blogId },
					'signet sign failed; issuance rolled back'
				);
				throw error(502, 'vote signer is unavailable, please try again');
			}
			throw error(400, 'invalid blinded message');
		default:
			// Exhaustiveness guard: a new IssueResult status must be handled above.
			throw error(500, 'unexpected issuance result');
	}
};
