import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { requireCapability } from '$lib/server/auth';
import { getVoteSigner } from '$lib/server/vote-signer';

// Return the blog's vote-token issuer PUBLIC key for a version, so the client can
// blind a nonce before requesting issuance. Authenticated + can_review-gated:
// only an eligible reviewer learns the key (it's not secret, but gating keeps the
// issuer key surface aligned with eligibility). Consumes no token and records no
// issuance — this is a pure preflight.
//
// The key is sourced via the VoteSigner: local mode reads/creates it in
// blog_vote_token_keys; Signet mode fetches it from GET /key. In Signet mode the
// key may still be generating, in which case we return 202 { status: 'pending' }
// and the client shows "preparing voting…" and retries (pre-gen normally makes
// this rare).
export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const versionId = url.searchParams.get('post_version_id');
	if (!versionId || !/^[0-9a-f-]{36}$/i.test(versionId)) {
		throw error(422, 'post_version_id required');
	}

	const rows = await db
		.select({ post: schema.blogPosts })
		.from(schema.blogPostVersions)
		.innerJoin(schema.blogPosts, eq(schema.blogPosts.id, schema.blogPostVersions.postId))
		.where(eq(schema.blogPostVersions.id, versionId))
		.limit(1);
	const row = rows[0];
	if (!row) throw error(404, 'post version not found');

	await requireCapability(row.post.blogId, locals.user.id, 'review');

	const pk = await getVoteSigner().getPublicKey(row.post.blogId);
	if (pk.status === 'pending') {
		return json({ status: 'pending' }, { status: 202 });
	}
	return json({ public_key: Buffer.from(pk.publicKeySpki).toString('base64url') });
};
