import { db, schema } from './client';
import { and, eq, isNull } from 'drizzle-orm';
import { isUniqueViolation } from '$lib/server/db-errors';
import type {
	IssuanceStore,
	KeyStore,
	IssuerKeyPair,
	PublicKeySpki,
	TokenScope
} from '@ministryofmany/blind-token/server';

// FreedInk's Drizzle implementations of @ministryofmany/blind-token's injectable
// storage seams (the package holds NO ORM). Two contracts:
//   - KeyStore over blog_vote_token_keys (LocalSigner only): the issuer key pair,
//     one active per blog via the partial unique index; keygen is INJECTED by the
//     LocalSigner (generateIssuerKey) rather than baked in here.
//   - IssuanceStore over vote_token_issuances: the one-per-(blog, user, version)
//     reservation guard the Issuer drives (reserve record-first / release on a
//     failed sign). The timing-leak coarsening (truncateToHour) stays app-side.
//
// The (group, participant, actionKey) tuple maps to FreedInk as
// (blogId, userId, postVersionId).

// ─────────────────────────── KeyStore (blog_vote_token_keys) ───────────────────

// Normalize a Postgres bytea value to a fresh, exact-length Uint8Array with its
// own backing ArrayBuffer (byteOffset 0). postgres-js returns bytea as a Node
// Buffer, which is a VIEW into a shared allocation pool; @ministryofmany/blind-token
// imports keys via `bytes.slice().buffer`, and Buffer.prototype.slice returns a
// pooled view, so `.buffer` would hand WebCrypto the whole pool (→ "asn1 wrong
// tag"). `new Uint8Array(buf)` COPIES into an exact-length buffer so the package's
// slice().buffer yields the real key bytes. (The bug is in the package's importKey;
// this is the consumer-side guard until it lands there — see the migration notes.)
function toKeyBytes(b: Uint8Array): Uint8Array {
	return new Uint8Array(b);
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
	const row = rows[0];
	if (!row) return null;
	return {
		id: row.id,
		publicKeySpki: toKeyBytes(row.publicKeySpki),
		privateKeyPkcs8: toKeyBytes(row.privateKeyPkcs8)
	};
}

// Public key only — used by the redemption (vote) endpoint to verify a token.
// Reads the active key. (KeyStore.getActivePublicKey.)
export async function getVoteTokenPublicKey(blogId: string): Promise<PublicKeySpki | null> {
	const k = await activeKey(blogId);
	return k?.publicKeySpki ?? null;
}

// Fetch the blog's ACTIVE (non-retired) vote-token issuer key, creating one via
// the injected `generate` on first use. Concurrency-safe: a unique partial index
// (blog_vote_token_keys_blog_active_key) guarantees at most one active key per
// blog, so a racing second insert hits the conflict and we re-read the winner.
export async function getOrCreateVoteTokenKey(
	blogId: string,
	generate: () => Promise<IssuerKeyPair>
): Promise<IssuerKeyPair & { id: string }> {
	const existing = await activeKey(blogId);
	if (existing) return existing;

	const generated = await generate();
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
		return {
			id: row.id,
			publicKeySpki: toKeyBytes(row.publicKeySpki),
			privateKeyPkcs8: toKeyBytes(row.privateKeyPkcs8)
		};
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

// Retire the current active key and install a freshly generated one. Drives
// blog_vote_token_keys.retiredAt: set it on the old active row, then insert the
// new one as active (the partial unique index guarantees exactly one active key
// per blog). Wired NOW so per-round rotation later is not a breaking change; the
// LocalSigner's rotateKey() calls this. Runs in a transaction so the retire +
// insert are atomic.
export async function rotateVoteTokenKey(
	blogId: string,
	generate: () => Promise<IssuerKeyPair>
): Promise<IssuerKeyPair & { id: string }> {
	const generated = await generate();
	return db.transaction(async (tx) => {
		await tx
			.update(schema.blogVoteTokenKeys)
			.set({ retiredAt: new Date() })
			.where(
				and(eq(schema.blogVoteTokenKeys.blogId, blogId), isNull(schema.blogVoteTokenKeys.retiredAt))
			);
		const [row] = await tx
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
		return {
			id: row.id,
			publicKeySpki: toKeyBytes(row.publicKeySpki),
			privateKeyPkcs8: toKeyBytes(row.privateKeyPkcs8)
		};
	});
}

// The KeyStore the LocalSigner drives. `generate` is supplied by the signer on
// each call (it carries the injected modulusLength + safe-prime generator), so
// keygen never lives in this store.
export const freedinkKeyStore: KeyStore = {
	getActivePublicKey: (group) => getVoteTokenPublicKey(group),
	getOrCreateKeyPair: (group, generate) => getOrCreateVoteTokenKey(group, generate),
	rotateKeyPair: (group, generate) => rotateVoteTokenKey(group, generate)
};

// ─────────────────────────── IssuanceStore (vote_token_issuances) ──────────────

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
// is not burned by a failure they did not cause and can retry. It is a no-op if
// the row is already gone. It must NEVER be called after a successful sign: that
// would let a user re-issue.
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

// The IssuanceStore the Issuer drives. The (group, participant, actionKey) tuple
// is FreedInk's (blogId, userId, postVersionId). reserve is record-first (the
// UNIQUE index makes a concurrent double-issue lose the race); release is only
// ever called by the Issuer on a FAILED sign, never after success.
export const freedinkIssuanceStore: IssuanceStore = {
	reserve: (key: TokenScope) =>
		recordIssuance({ blogId: key.group, postVersionId: key.actionKey, userId: key.participant }),
	release: (key: TokenScope) =>
		releaseIssuance({ postVersionId: key.actionKey, userId: key.participant })
};
