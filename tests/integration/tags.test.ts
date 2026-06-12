import { describe, it, expect } from 'vitest';
import {
	listAllTags,
	getOrCreateTag,
	setPostTags,
	getTagsForPost,
	searchPublishedPosts,
	suggestTags
} from '$lib/db/tags';
import { createPost, setPostStatus } from '$lib/db/posts';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('getOrCreateTag', () => {
	it('creates a tag on first call, returns the same row on subsequent calls', async () => {
		const a = await getOrCreateTag('zk');
		const b = await getOrCreateTag('zk');
		expect(b.id).toBe(a.id);
		expect(a.slug).toBe('zk');
	});

	it('sluggifies names', async () => {
		const t = await getOrCreateTag('Privacy First!');
		expect(t.slug).toBe('privacy-first');
		expect(t.name).toBe('Privacy First!');
	});
});

describe('setPostTags', () => {
	it('attaches a tag set to a post', async () => {
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
		await setPostTags(r.post.id, ['zk', 'crypto']);
		const tags = await getTagsForPost(r.post.id);
		expect(tags.map((t) => t.slug).sort()).toEqual(['crypto', 'zk']);
	});

	it('replaces the tag set on subsequent calls', async () => {
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
		await setPostTags(r.post.id, ['a', 'b', 'c']);
		await setPostTags(r.post.id, ['a', 'd']);
		const tags = await getTagsForPost(r.post.id);
		expect(tags.map((t) => t.slug).sort()).toEqual(['a', 'd']);
	});

	it('empty tag list clears all tags', async () => {
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
		await setPostTags(r.post.id, ['x']);
		await setPostTags(r.post.id, []);
		expect(await getTagsForPost(r.post.id)).toEqual([]);
	});
});

describe('listAllTags / suggestTags', () => {
	it('listAllTags returns alphabetized names', async () => {
		await getOrCreateTag('zebra');
		await getOrCreateTag('apple');
		await getOrCreateTag('mango');
		const all = await listAllTags();
		expect(all.map((t) => t.name)).toEqual(['apple', 'mango', 'zebra']);
	});

	it('suggestTags does case-insensitive substring match', async () => {
		await getOrCreateTag('CryptoZK');
		await getOrCreateTag('plain crypto');
		await getOrCreateTag('something else');
		const out = await suggestTags('crypt', 10);
		expect(out.map((t) => t.name).sort()).toEqual(['CryptoZK', 'plain crypto']);
	});
});

describe('searchPublishedPosts (Postgres FTS)', () => {
	async function setupBlogWithPublishedPost(title: string, content: string, tags: string[] = []) {
		const owner = await makeUser({ username: `o${Math.random().toString(36).slice(2, 6)}` });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title,
			content,
			proof: {},
			snapshotRoot: 'r',
			nullifier: `n${Math.random()}`,
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');
		if (tags.length > 0) await setPostTags(r.post.id, tags);
		return { blogId, postId: r.post.id };
	}

	it('returns a post matching a title term', async () => {
		await setupBlogWithPublishedPost('Anonymous Manifesto', 'Body about freedom');
		const hits = await searchPublishedPosts({ query: 'anonymous' });
		expect(hits.length).toBe(1);
		expect(hits[0].version.title).toBe('Anonymous Manifesto');
	});

	it('returns a post matching a body term', async () => {
		await setupBlogWithPublishedPost('Misc', 'discussion of zero-knowledge proofs');
		const hits = await searchPublishedPosts({ query: 'zero-knowledge' });
		expect(hits.length).toBe(1);
	});

	it('excludes drafts and under_review posts', async () => {
		const owner = await makeUser({ username: 'owner' });
		const { id: blogId } = await makeBlogWith({ owner });
		await createPost({
			blogId,
			title: 'Draft Post',
			content: 'searchterm goes here',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'n',
			status: 'draft'
		});
		const hits = await searchPublishedPosts({ query: 'searchterm' });
		expect(hits.length).toBe(0);
	});

	it('filters by tag slug', async () => {
		await setupBlogWithPublishedPost('A', 'content', ['privacy']);
		await setupBlogWithPublishedPost('B', 'content', ['other']);
		const hits = await searchPublishedPosts({ tagSlug: 'privacy' });
		expect(hits.length).toBe(1);
		expect(hits[0].version.title).toBe('A');
	});

	it('combines query + tag filter', async () => {
		await setupBlogWithPublishedPost('Auth Guide', 'body', ['security']);
		await setupBlogWithPublishedPost('Misc', 'auth content', ['other']);
		const hits = await searchPublishedPosts({ query: 'auth', tagSlug: 'security' });
		expect(hits.length).toBe(1);
		expect(hits[0].version.title).toBe('Auth Guide');
	});

	it('respects limit', async () => {
		for (let i = 0; i < 5; i++) {
			await setupBlogWithPublishedPost(`Post ${i}`, 'shared keyword here');
		}
		const hits = await searchPublishedPosts({ query: 'shared', limit: 3 });
		expect(hits.length).toBe(3);
	});
});
