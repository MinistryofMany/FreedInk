import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireCapability } from '$lib/server/auth';
import { enforce, RULES } from '$lib/server/rate-limit';
import { getOrCreateVoteTokenKey, recordIssuance } from '$lib/db/vote-tokens';
import { blindSignVoteToken } from '$lib/server/vote-token';

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
// issued a token for this version. The server blind-signs over (version_id
// metadata, blinded nonce) — it never sees the unblinded nonce, so it cannot
// link this issuance to the eventual vote. One token per (user, version) is
// enforced by the unique index on vote_token_issuances.
//
// We record the issuance FIRST (atomic one-per-(user,version) guard) and only
// blind-sign if it was newly recorded, so two concurrent requests can never both
// receive a token. The public key is returned so a fresh client can finalize +
// later verify-shape without a second round-trip.
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
	// ineligible user).
	await requireCapability(row.post.blogId, locals.user.id, 'review');

	// One token per (user, version): record FIRST. If already issued, refuse.
	const fresh = await recordIssuance({
		blogId: row.post.blogId,
		postVersionId: parsed.data.post_version_id,
		userId: locals.user.id
	});
	if (!fresh) throw error(409, 'a vote token has already been issued to you for this version');

	const key = await getOrCreateVoteTokenKey(row.post.blogId);
	const blindedMessage = b64urlToBytes(parsed.data.blinded_message);
	let blindSignature: Uint8Array;
	try {
		blindSignature = await blindSignVoteToken({
			privateKeyPkcs8: key.privateKeyPkcs8,
			blindedMessage,
			versionId: parsed.data.post_version_id
		});
	} catch {
		// A malformed blinded message is a client error, not a server fault. The
		// issuance row remains (one-per-version), which is acceptable: the client
		// must send a well-formed blinded message.
		throw error(400, 'invalid blinded message');
	}

	return json({
		blind_signature: Buffer.from(blindSignature).toString('base64url'),
		public_key: Buffer.from(key.publicKeySpki).toString('base64url')
	});
};
