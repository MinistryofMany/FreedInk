import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import { generateVoteTokenKey } from '$lib/server/vote-token';

// Fetch the blog's ACTIVE (non-retired) vote-token issuer key, creating one on
// first use. Concurrency-safe: a unique partial index
// (blog_vote_token_keys_blog_active_key) guarantees at most one active key per
// blog, so a racing second insert hits the conflict and we re-read the winner.
export async function getOrCreateVoteTokenKey(blogId: string): Promise<{
	id: string;
	publicKeySpki: Uint8Array;
	privateKeyPkcs8: Uint8Array;
}> {
	const existing = await activeKey(blogId);
	if (existing) return existing;

	const generated = await generateVoteTokenKey();
	try {
		const [row] = await db
			.insert(schema.blogVoteTokenKeys)
			.values({
				blogId,
				publicKeySpki: generated.publicKeySpki,
				privateKeyPkcs8: generated.privateKeyPkcs8
			})
			.returning({
				id: schema.blogVoteTokenKeys.id,
				publicKeySpki: schema.blogVoteTokenKeys.publicKeySpki,
				privateKeyPkcs8: schema.blogVoteTokenKeys.privateKeyPkcs8
			});
		return row;
	} catch {
		// Lost the race to another request; the winner's key is now active.
		const winner = await activeKey(blogId);
		if (winner) return winner;
		throw new Error('failed to create or read vote-token key');
	}
}

async function activeKey(blogId: string) {
	const rows = await db
		.select({
			id: schema.blogVoteTokenKeys.id,
			publicKeySpki: schema.blogVoteTokenKeys.publicKeySpki,
			privateKeyPkcs8: schema.blogVoteTokenKeys.privateKeyPkcs8
		})
		.from(schema.blogVoteTokenKeys)
		.where(
			and(eq(schema.blogVoteTokenKeys.blogId, blogId), isNull(schema.blogVoteTokenKeys.retiredAt))
		)
		.limit(1);
	return rows[0] ?? null;
}

// Public key only — used by the redemption (vote) endpoint to verify a token.
// Reads the active key. (Per-round rotation would verify against the round's key
// id; v1 uses the single active key.)
export async function getVoteTokenPublicKey(blogId: string): Promise<Uint8Array | null> {
	const k = await activeKey(blogId);
	return k?.publicKeySpki ?? null;
}

// Record that a user was issued a token for a version. Returns true if newly
// recorded, false if they had already been issued one (the unique index on
// (version, user) is the authoritative one-token-per-(user,version) guard).
export async function recordIssuance(opts: {
	blogId: string;
	postVersionId: string;
	userId: string;
}): Promise<boolean> {
	const inserted = await db
		.insert(schema.voteTokenIssuances)
		.values({
			blogId: opts.blogId,
			postVersionId: opts.postVersionId,
			userId: opts.userId
		})
		.onConflictDoNothing({
			target: [schema.voteTokenIssuances.postVersionId, schema.voteTokenIssuances.userId]
		})
		.returning({ id: schema.voteTokenIssuances.id });
	return inserted.length > 0;
}
