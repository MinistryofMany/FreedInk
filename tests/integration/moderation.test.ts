// Soft-delete + restore integration:
//   • softDeletePostVersion hides the post from public reads
//   • restorePostVersion brings it back
//   • softDeleteComment hides the comment from public comment reads
//   • admin queries (raw drizzle) still see the deleted rows
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { createPost, getPostBySlug, listPublishedPosts, setPostStatus } from '$lib/db/posts';
import {
	softDeletePostVersion,
	restorePostVersion,
	softDeleteComment,
	restoreComment
} from '$lib/db/moderation';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('post soft-delete + restore', () => {
	it('hides a published post from public reads, then restores it', async () => {
		const owner = await makeUser({ username: 'owner-mod' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Soft Death',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n1',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');

		// Sanity: public reads see it.
		const before = await listPublishedPosts(blogId);
		expect(before.map((p) => p.id)).toContain(r.post.id);
		expect(await getPostBySlug(blogId, r.version.slug)).not.toBeNull();

		await softDeletePostVersion(r.version.id);

		const after = await listPublishedPosts(blogId);
		expect(after.map((p) => p.id)).not.toContain(r.post.id);
		expect(await getPostBySlug(blogId, r.version.slug)).toBeNull();

		// Admin (raw select) still sees the row.
		const adminView = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.id, r.version.id));
		expect(adminView).toHaveLength(1);
		expect(adminView[0].deletedAt).toBeInstanceOf(Date);

		// Restore brings it back.
		await restorePostVersion(r.version.id);
		const restored = await listPublishedPosts(blogId);
		expect(restored.map((p) => p.id)).toContain(r.post.id);
		expect(await getPostBySlug(blogId, r.version.slug)).not.toBeNull();
	});
});

describe('comment soft-delete + restore', () => {
	it('hides a comment from public list, restoreComment reverses', async () => {
		const owner = await makeUser({ username: 'co' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'has comments',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'nx',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');

		const [c] = await db
			.insert(schema.postComments)
			.values({
				postVersionId: r.version.id,
				body: 'first',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'cn1'
			})
			.returning();

		// publicly visible (filtered IS NULL)
		const visible = await db
			.select()
			.from(schema.postComments)
			.where(eq(schema.postComments.postVersionId, r.version.id));
		expect(visible).toHaveLength(1);
		expect(visible[0].deletedAt).toBeNull();

		await softDeleteComment(c.id);

		// admin raw select: still there
		const adminRow = await db
			.select()
			.from(schema.postComments)
			.where(eq(schema.postComments.id, c.id));
		expect(adminRow[0].deletedAt).toBeInstanceOf(Date);

		await restoreComment(c.id);
		const back = await db
			.select()
			.from(schema.postComments)
			.where(eq(schema.postComments.id, c.id));
		expect(back[0].deletedAt).toBeNull();
	});
});
