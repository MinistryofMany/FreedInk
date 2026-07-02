// Local-mode vote-key pre-generation + issuance rollback.
//
// LOCAL backend (SIGNET_URL unset, the default): the LocalSigner's ensureKey()
// warms a blog's issuer key off the request path (in-process safe-prime keygen).
// releaseIssuance rolls back a reservation when signing fails so a user's single
// one-per-(user,version) token is not burned by a failure they didn't cause.
// These are the local equivalents of Signet's async POST /key and its
// "reservation rolled back if signing fails" behavior.

import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { getVoteTokenPublicKey, recordIssuance, releaseIssuance } from '$lib/db/vote-tokens';
import { getVoteSigner } from '$lib/server/vote-signer';
import { createPost } from '$lib/db/posts';
import { makeUser, makeBlogWith } from '../setup/factories';

// A SOLO-owner blog: exactly one reviewer-capable member, so the "2nd reviewer"
// pre-gen trigger (a) does NOT fire on setup. This keeps the "no key exists yet"
// assertions deterministic — otherwise the fire-and-forget trigger could race in
// and create a key before the test checks. The owner still holds can_review, so
// it can author + self-review.
async function soloBlog(tag: string) {
	const owner = await makeUser({ username: `pg-${tag}-o` });
	const blog = await makeBlogWith({ owner });
	return { blog, owner };
}

describe('local vote-key pre-gen', () => {
	it('the default signer is local (SIGNET_URL unset in the test env)', () => {
		expect(getVoteSigner().backend).toBe('local');
	});

	it('the local signer ensureKey creates an active key when none exists (idempotent)', async () => {
		const { blog } = await soloBlog('ensure');
		expect(await getVoteTokenPublicKey(blog.id)).toBeNull();

		await getVoteSigner().ensureKey(blog.id);

		const pk = await getVoteTokenPublicKey(blog.id);
		expect(pk).not.toBeNull();
		expect(pk!.length).toBeGreaterThan(0);

		// Idempotent: a second call does not create a second active key.
		await getVoteSigner().ensureKey(blog.id);
		const rows = await db
			.select({ id: schema.blogVoteTokenKeys.id })
			.from(schema.blogVoteTokenKeys)
			.where(eq(schema.blogVoteTokenKeys.blogId, blog.id));
		expect(rows).toHaveLength(1);
	}, 30_000);

	it('creating a post straight into under_review pre-gens the key (event trigger b)', async () => {
		const { blog, owner } = await soloBlog('enterreview');
		expect(await getVoteTokenPublicKey(blog.id)).toBeNull();

		await createPost({
			blogId: blog.id,
			title: 'Pre-gen on review',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: `pg-enter-${owner.id}`,
			status: 'under_review'
		});

		// The pre-gen is fire-and-forget; poll briefly for the background keygen.
		let pk: Uint8Array | null = null;
		for (let i = 0; i < 20; i++) {
			pk = await getVoteTokenPublicKey(blog.id);
			if (pk) break;
			await new Promise((r) => setTimeout(r, 250));
		}
		expect(pk).not.toBeNull();
	}, 30_000);

	it('releaseIssuance rolls back a reservation so the token is not burned', async () => {
		// The owner holds can_review, so it doubles as the reviewer here.
		const { blog, owner } = await soloBlog('rollback');
		const reviewerId = owner.id;
		const post = await createPost({
			blogId: blog.id,
			title: 'Rollback',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: `pg-rb-${owner.id}`,
			status: 'under_review'
		});

		// Reserve the (version, user) issuance …
		expect(
			await recordIssuance({
				blogId: blog.id,
				postVersionId: post.version.id,
				userId: reviewerId
			})
		).toBe(true);
		// A second reserve is refused (the one-per-(user,version) cap).
		expect(
			await recordIssuance({
				blogId: blog.id,
				postVersionId: post.version.id,
				userId: reviewerId
			})
		).toBe(false);

		// … roll it back (simulating a signer failure) …
		await releaseIssuance({ postVersionId: post.version.id, userId: reviewerId });
		const rows = await db
			.select({ id: schema.voteTokenIssuances.id })
			.from(schema.voteTokenIssuances)
			.where(
				and(
					eq(schema.voteTokenIssuances.postVersionId, post.version.id),
					eq(schema.voteTokenIssuances.userId, reviewerId)
				)
			);
		expect(rows).toHaveLength(0);

		// … and now the user can reserve again (token not burned).
		expect(
			await recordIssuance({
				blogId: blog.id,
				postVersionId: post.version.id,
				userId: reviewerId
			})
		).toBe(true);
	}, 30_000);
});
