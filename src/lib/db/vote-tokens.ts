import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import { generateVoteTokenKey } from '$lib/server/vote-token';
import { isUniqueViolation } from '$lib/server/db-errors';
import { log } from '$lib/server/log';

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
	} catch (e) {
		// Only a unique-violation means we lost the race to a concurrent insert
		// (the partial unique index blog_vote_token_keys_blog_active_key allows one
		// active key per blog) — in that case the winner's key is now active and we
		// re-read it. Any other error (connection drop, serialization failure, etc.)
		// is a real fault and must propagate, not be silently swallowed.
		if (!isUniqueViolation(e)) throw e;
		const winner = await activeKey(blogId);
		if (winner) return winner;
		throw new Error('failed to create or read vote-token key');
	}
}

// Pre-generation (LOCAL mode): ensure a key exists for the blog WITHOUT blocking
// the caller. Local safe-prime keygen is ~1s; this runs it off the request path
// so a freshly-created under_review post (or a blog's 2nd reviewer) warms the key
// before the first vote is attempted. Idempotent and concurrency-safe:
// getOrCreateVoteTokenKey no-ops when a key already exists and loses-the-race
// re-reads on a unique violation. A failure here is non-fatal (the on-demand
// getOrCreateVoteTokenKey at issuance time is the hard guarantee) — we log it.
//
// Concurrency note: a second in-flight keygen for the same blog can still race to
// the insert and lose on the partial unique index; that path is handled inside
// getOrCreateVoteTokenKey, which re-reads the winner. So at most one wasted ~1s
// keygen, never a duplicate active key.
export async function ensureLocalVoteTokenKey(blogId: string): Promise<void> {
	try {
		const existing = await getVoteTokenPublicKey(blogId);
		if (existing) return;
		await getOrCreateVoteTokenKey(blogId);
	} catch (err) {
		log.warn({ err, blogId }, 'local vote-token key pre-gen failed');
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

// Coarsen a timestamp to the start of its UTC hour. We store issuance times at
// hour resolution (not the default sub-millisecond now()) so an operator reading
// vote_token_issuances cannot pin an issuance to a precise instant and pair it
// with a redemption (post_reviews.created_at) by timestamp.
//
// RESIDUAL (documented, not eliminated): hour-coarsening only helps when more
// than one issuance and/or vote falls in the same hour — in a low-traffic blog
// where a lone reviewer is issued the only token of the hour and the only vote
// of the hour also lands in that hour, the pairing is still inferable from the
// shared bucket plus the fact that the eligible-reviewer set is tiny. Combined
// with the client-side redemption jitter (see castVote) this raises the cost of
// the side-channel; it does not erase it. The hard floor on linkability is the
// eligible-reviewer population size, which crypto cannot enlarge.
function truncateToHour(d: Date): Date {
	const t = new Date(d);
	t.setUTCMinutes(0, 0, 0);
	return t;
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
			userId: opts.userId,
			// Coarsen to the hour (see truncateToHour) — timing-leak mitigation.
			createdAt: truncateToHour(new Date())
		})
		.onConflictDoNothing({
			target: [schema.voteTokenIssuances.postVersionId, schema.voteTokenIssuances.userId]
		})
		.returning({ id: schema.voteTokenIssuances.id });
	return inserted.length > 0;
}

// Roll back an issuance reservation. Called ONLY when signing fails AFTER a fresh
// recordIssuance (e.g. the signer returned `pending`/`rate_limited`, or threw on a
// transient transport error) — so the user's single one-per-(user,version) token
// is not burned by a failure they did not cause and can retry. This mirrors
// Signet's own "reservation rolled back if signing fails" behavior on the
// FreedInk side. It is a no-op if the row is already gone. It must NEVER be called
// after a successful sign: that would let a user re-issue.
export async function releaseIssuance(opts: {
	postVersionId: string;
	userId: string;
}): Promise<void> {
	await db
		.delete(schema.voteTokenIssuances)
		.where(
			and(
				eq(schema.voteTokenIssuances.postVersionId, opts.postVersionId),
				eq(schema.voteTokenIssuances.userId, opts.userId)
			)
		);
}
