// Integration tests for the post-editor DB helper. createPostVersion drives
// the version-bump + current_version_id swap; getEditablePostForUser is the
// load-time gate the edit page uses.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { createPost } from '$lib/db/posts';
import {
	createPostVersion,
	getEditablePostForUser,
	getCurrentPostBySlugForEdit
} from '$lib/db/post-editor';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('createPostVersion', () => {
	it('increments version and updates currentVersionId', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const first = await createPost({
			blogId,
			title: 'Original',
			content: 'v1 body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n1',
			status: 'draft'
		});
		expect(first.version.version).toBe(1);

		const second = await createPostVersion({
			postId: first.post.id,
			title: 'Original (v2)',
			content: 'v2 body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n2',
			submitForReview: false
		});
		expect(second.nextVersion).toBe(2);
		expect(second.version.version).toBe(2);

		const post = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, first.post.id))
			.limit(1);
		expect(post[0].currentVersionId).toBe(second.version.id);
		expect(post[0].status).toBe('draft');
	});

	it('keeps previous versions intact when adding a new one', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const first = await createPost({
			blogId,
			title: 'Keep me',
			content: 'v1',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'na',
			status: 'draft'
		});
		await createPostVersion({
			postId: first.post.id,
			title: 'Keep me (v2)',
			content: 'v2',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'nb',
			submitForReview: false
		});

		// Both versions must still be in the DB.
		const allVersions = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.postId, first.post.id));
		expect(allVersions.map((v) => v.version).sort()).toEqual([1, 2]);
	});

	it('flips post.status and stamps submittedAt when submitForReview=true', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const first = await createPost({
			blogId,
			title: 'D',
			content: 'd',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'x',
			status: 'draft'
		});
		const result = await createPostVersion({
			postId: first.post.id,
			title: 'D2',
			content: 'd2',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'y',
			submitForReview: true
		});
		expect(result.version.status).toBe('under_review');
		expect(result.version.submittedAt).toBeInstanceOf(Date);

		const post = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, first.post.id))
			.limit(1);
		expect(post[0].status).toBe('under_review');
	});

	it('rejects duplicate (post_id, nullifier) at the DB layer', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const first = await createPost({
			blogId,
			title: 'P',
			content: 'p',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'shared',
			status: 'draft'
		});
		await expect(
			createPostVersion({
				postId: first.post.id,
				title: 'P2',
				content: 'p2',
				proof: {},
				snapshotRoot: 'r',
				nullifier: 'shared',
				submitForReview: false
			})
		).rejects.toThrow();

		// Previous version must still exist + still be current despite the
		// failed insert (txn rollback).
		const versions = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.postId, first.post.id));
		expect(versions.length).toBe(1);
		const post = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, first.post.id))
			.limit(1);
		expect(post[0].currentVersionId).toBe(first.version.id);
	});
});

describe('getEditablePostForUser', () => {
	it('returns the row when the user has writing rights on the current version', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const p = await createPost({
			blogId,
			title: 'editable',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'draft'
		});
		const row = await getEditablePostForUser(p.version.id, owner.id);
		expect(row.post.id).toBe(p.post.id);
		expect(row.version.id).toBe(p.version.id);
	});

	it('throws 403 when the user has no writing role on the blog', async () => {
		const owner = await makeUser({ username: 'owner' });
		const stranger = await makeUser({ username: 'stranger' });
		const { id: blogId } = await makeBlogWith({ owner });
		const p = await createPost({
			blogId,
			title: 't',
			content: 'b',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'draft'
		});
		await expect(getEditablePostForUser(p.version.id, stranger.id)).rejects.toMatchObject({
			status: 403
		});
	});

	it('throws 409 when the version is no longer the current one', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const p = await createPost({
			blogId,
			title: 't',
			content: 'b',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n0',
			status: 'draft'
		});
		await createPostVersion({
			postId: p.post.id,
			title: 't2',
			content: 'b2',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n1',
			submitForReview: false
		});
		await expect(getEditablePostForUser(p.version.id, owner.id)).rejects.toMatchObject({
			status: 409
		});
	});
});

describe('getCurrentPostBySlugForEdit', () => {
	it('finds the live current version by its slug', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const p = await createPost({
			blogId,
			title: 'Find Me',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'draft'
		});
		const row = await getCurrentPostBySlugForEdit(blogId, 'find-me');
		expect(row?.post.id).toBe(p.post.id);
		expect(row?.version.id).toBe(p.version.id);
	});

	it('returns null for an unknown slug', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		expect(await getCurrentPostBySlugForEdit(blogId, 'nope')).toBeNull();
	});
});
