// Phase 5 / timing-leak mitigation — vote-token issuance data layer.
// recordIssuance writes the issuance timestamp COARSENED to the UTC hour so an
// operator cannot pair an issuance with a redemption by precise timestamp.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { recordIssuance } from '$lib/db/vote-tokens';
import { createPost } from '$lib/db/posts';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('recordIssuance', () => {
	it('stores created_at truncated to the start of the UTC hour', async () => {
		const owner = await makeUser({ username: 'ti-owner' });
		const reviewer = await makeUser({ username: 'ti-rev' });
		const { id: blogId } = await makeBlogWith({
			owner,
			members: [{ user: reviewer, role: 'reviewer' }]
		});
		const post = await createPost({
			blogId,
			title: 'Timing',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'ti-n',
			status: 'under_review'
		});

		const fresh = await recordIssuance({
			blogId,
			postVersionId: post.version.id,
			userId: reviewer.id
		});
		expect(fresh).toBe(true);

		const rows = await db
			.select({ createdAt: schema.voteTokenIssuances.createdAt })
			.from(schema.voteTokenIssuances)
			.where(eq(schema.voteTokenIssuances.postVersionId, post.version.id));
		expect(rows).toHaveLength(1);
		const ts = rows[0].createdAt;
		// Coarsened: minutes/seconds/ms are all zero (UTC hour boundary).
		expect(ts.getUTCMinutes()).toBe(0);
		expect(ts.getUTCSeconds()).toBe(0);
		expect(ts.getUTCMilliseconds()).toBe(0);
	});

	it('is idempotent per (version, user): a second call returns false', async () => {
		const owner = await makeUser({ username: 'ti-owner2' });
		const reviewer = await makeUser({ username: 'ti-rev2' });
		const { id: blogId } = await makeBlogWith({
			owner,
			members: [{ user: reviewer, role: 'reviewer' }]
		});
		const post = await createPost({
			blogId,
			title: 'Timing2',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'ti-n2',
			status: 'under_review'
		});
		expect(
			await recordIssuance({ blogId, postVersionId: post.version.id, userId: reviewer.id })
		).toBe(true);
		expect(
			await recordIssuance({ blogId, postVersionId: post.version.id, userId: reviewer.id })
		).toBe(false);
	});
});
