import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import {
	listPublishedPosts,
	listAllPosts,
	getPostBySlug,
	getPostsUnderReview,
	createPost,
	submitForReview,
	setPostStatus
} from '$lib/db/posts';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('createPost', () => {
	it('creates a post + first version, marks it as draft when not submitting', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const result = await createPost({
			blogId,
			title: 'Hello',
			content: 'World',
			proof: { stub: true },
			snapshotRoot: 'stub-root',
			nullifier: 'n1',
			status: 'draft'
		});
		expect(result.post.status).toBe('draft');
		expect(result.version.status).toBe('draft');
		expect(result.version.title).toBe('Hello');
		expect(result.version.slug).toBe('hello');
		expect(result.version.submittedAt).toBeNull();

		// post.current_version_id should be wired to the inserted version.
		const post = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, result.post.id))
			.limit(1);
		expect(post[0].currentVersionId).toBe(result.version.id);
	});

	it('marks as under_review and stamps submittedAt when status=under_review', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Live',
			content: 'now',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n2',
			status: 'under_review'
		});
		expect(r.post.status).toBe('under_review');
		expect(r.version.status).toBe('under_review');
		expect(r.version.submittedAt).toBeInstanceOf(Date);
	});

	it('enforces UNIQUE (post_id, nullifier) — second submission with the same nullifier is rejected at the DB layer', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await createPost({
			blogId,
			title: 'A',
			content: 'a',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'shared',
			status: 'draft'
		});
		// Same post creates a new row in blog_posts so the unique key (post_id,
		// nullifier) doesn't collide — but if the same user/identity tried to
		// post against the same post_id with the same scope-based nullifier,
		// they would. Simulate by manually inserting into the same post.
		const posts = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.blogId, blogId));
		const postId = posts[0].id;
		await expect(
			db.insert(schema.blogPostVersions).values({
				postId,
				version: 2,
				title: 'A',
				content: 'a',
				slug: 'a',
				nullifier: 'shared',
				status: 'draft'
			})
		).rejects.toThrow();
	});
});

describe('listPublishedPosts / listAllPosts', () => {
	it('listPublishedPosts only includes posts with status=published', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const a = await createPost({
			blogId,
			title: 'P1',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'na',
			status: 'draft'
		});
		const b = await createPost({
			blogId,
			title: 'P2',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'nb',
			status: 'under_review'
		});
		await setPostStatus(b.post.id, b.version.id, 'published');

		const published = await listPublishedPosts(blogId);
		expect(published.map((p) => p.id)).toEqual([b.post.id]);

		const all = await listAllPosts(blogId);
		expect(all.map((p) => p.id).sort()).toEqual([a.post.id, b.post.id].sort());
	});
});

describe('getPostBySlug', () => {
	it('looks up by (blog_id, version_slug) joining the current version', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Findable Post',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'draft'
		});
		const got = await getPostBySlug(blogId, 'findable-post');
		expect(got?.post.id).toBe(r.post.id);
		expect(got?.version.title).toBe('Findable Post');
	});

	it('returns null for an unknown slug', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		expect(await getPostBySlug(blogId, 'nope')).toBeNull();
	});
});

describe('getPostsUnderReview', () => {
	it('returns only under_review posts in the given blog set', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: b1 } = await makeBlogWith({ owner, title: 'B1' });
		const { id: b2 } = await makeBlogWith({ owner, title: 'B2' });

		await createPost({
			blogId: b1,
			title: 'd1',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: '1',
			status: 'draft'
		});
		const ur = await createPost({
			blogId: b1,
			title: 'ur',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: '2',
			status: 'under_review'
		});
		await createPost({
			blogId: b2,
			title: 'ur2',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: '3',
			status: 'under_review'
		});

		const onlyB1 = await getPostsUnderReview([b1]);
		expect(onlyB1.map((p) => p.id)).toEqual([ur.post.id]);

		const both = await getPostsUnderReview([b1, b2]);
		expect(both.length).toBe(2);

		expect(await getPostsUnderReview([])).toEqual([]);
	});
});

describe('submitForReview', () => {
	it('transitions a draft to under_review on both post and version', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 't',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'draft'
		});
		await submitForReview(r.version.id);
		const post = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, r.post.id))
			.limit(1);
		const version = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.id, r.version.id))
			.limit(1);
		expect(post[0].status).toBe('under_review');
		expect(version[0].status).toBe('under_review');
		expect(version[0].submittedAt).toBeInstanceOf(Date);
	});
});

describe('setPostStatus', () => {
	it('stamps publishedAt when status=published', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 't',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');
		const v = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.id, r.version.id))
			.limit(1);
		expect(v[0].status).toBe('published');
		expect(v[0].publishedAt).toBeInstanceOf(Date);
	});

	it('clears publishedAt when status=rejected', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 't',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'rejected');
		const v = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.id, r.version.id))
			.limit(1);
		expect(v[0].status).toBe('rejected');
		expect(v[0].publishedAt).toBeNull();
	});
});
