// M4: moderation post-delete is an UNPUBLISH/ARCHIVE, never a hard delete.
//   • archivePost stamps blog_posts.archived_at and hides the post publicly
//   • unarchivePost clears it and the post is public again
//   • the round-trip preserves content, every version, and currentVersionId
//     (nothing is orphaned or destroyed)
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { createPost, getPostBySlug, setPostStatus } from '$lib/db/posts';
import { archivePost, unarchivePost } from '$lib/db/moderation';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('post archive / unarchive round-trip (M4)', () => {
	it('archives then restores a published post, preserving content + versions', async () => {
		const owner = await makeUser({ username: 'arch-owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Archive Me',
			content: 'original body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'am',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');

		// Add a second version row so we can prove version history survives.
		const [v2] = await db
			.insert(schema.blogPostVersions)
			.values({
				postId: r.post.id,
				version: 2,
				title: 'Archive Me v2',
				content: 'second body',
				slug: r.version.slug,
				nullifier: 'am2',
				status: 'published'
			})
			.returning();

		// Sanity: public before archiving.
		expect(await getPostBySlug(blogId, r.version.slug)).not.toBeNull();

		await archivePost(r.post.id);

		// Hidden from public reads.
		expect(await getPostBySlug(blogId, r.version.slug)).toBeNull();

		// Post row still present, content intact, archivedAt stamped, and the
		// currentVersionId pointer was NOT orphaned.
		const [postAfter] = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, r.post.id))
			.limit(1);
		expect(postAfter).toBeTruthy();
		expect(postAfter.archivedAt).toBeInstanceOf(Date);
		expect(postAfter.currentVersionId).toBe(r.version.id);
		expect(postAfter.status).toBe('published');

		// Both versions still exist (nothing hard-deleted).
		const versions = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.postId, r.post.id));
		expect(versions.map((v) => v.id).sort()).toEqual([r.version.id, v2.id].sort());
		const original = versions.find((v) => v.id === r.version.id);
		expect(original?.content).toBe('original body');

		// Restore brings it fully back.
		await unarchivePost(r.post.id);
		const [postRestored] = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, r.post.id))
			.limit(1);
		expect(postRestored.archivedAt).toBeNull();
		expect(postRestored.currentVersionId).toBe(r.version.id);

		const back = await getPostBySlug(blogId, r.version.slug);
		expect(back).not.toBeNull();
		expect(back?.post.id).toBe(r.post.id);
		expect(back?.version.content).toBe('original body');
	});

	it('unarchivePost is idempotent on a never-archived post (clears nothing, no throw)', async () => {
		const owner = await makeUser({ username: 'arch-idem' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Never Archived',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'na',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');

		await unarchivePost(r.post.id);
		const [post] = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, r.post.id))
			.limit(1);
		expect(post.archivedAt).toBeNull();
		expect(await getPostBySlug(blogId, r.version.slug)).not.toBeNull();
	});
});

// C2: there is NO one-post-per-identity rule. Blogs are collective and an
// identity may author many distinct posts. The only nullifier uniqueness is
// the per-post (post_id, nullifier) index, which just blocks replaying the
// exact same proof against the same post row. This test documents that the
// same nullifier value across DIFFERENT posts is accepted.
describe('post nullifier is not a per-identity dedup guard (C2)', () => {
	it('accepts the same nullifier on two different posts in the same blog', async () => {
		const owner = await makeUser({ username: 'c2-owner' });
		const { id: blogId } = await makeBlogWith({ owner });

		const first = await createPost({
			blogId,
			title: 'C2 First',
			content: 'a',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'shared-nullifier',
			status: 'draft'
		});
		// Same nullifier, different post row -> allowed (composite key is per-post).
		const second = await createPost({
			blogId,
			title: 'C2 Second',
			content: 'b',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'shared-nullifier',
			status: 'draft'
		});

		expect(first.post.id).not.toBe(second.post.id);
		expect(first.version.nullifier).toBe('shared-nullifier');
		expect(second.version.nullifier).toBe('shared-nullifier');
	});
});
