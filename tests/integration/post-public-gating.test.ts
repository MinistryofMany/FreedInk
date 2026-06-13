// H1 (privacy): the public slug loader and public listings must serve ONLY
// published, non-archived, non-deleted posts. Before the fix, getPostBySlug
// had no status filter at all, so draft / under_review / rejected / archived
// posts were readable by anyone who knew the slug. These tests pin that down.
import { describe, it, expect } from 'vitest';
import {
	createPost,
	getPostBySlug,
	listPublishedPosts,
	listPublishedPostsPage,
	setPostStatus
} from '$lib/db/posts';
import { archivePost } from '$lib/db/moderation';
import { makeUser, makeBlogWith } from '../setup/factories';

describe('public slug loader status gating (H1)', () => {
	it('does not serve a draft post by slug', async () => {
		const owner = await makeUser({ username: 'gate-draft' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Draft Secret',
			content: 'unpublished body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'gd',
			status: 'draft'
		});
		// The slug exists on the version, but the post is a draft -> not public.
		expect(await getPostBySlug(blogId, r.version.slug)).toBeNull();
	});

	it('does not serve an under_review post by slug', async () => {
		const owner = await makeUser({ username: 'gate-review' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Pending Review',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'gr',
			status: 'under_review'
		});
		expect(await getPostBySlug(blogId, r.version.slug)).toBeNull();
	});

	it('does not serve a rejected post by slug', async () => {
		const owner = await makeUser({ username: 'gate-reject' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Rejected Post',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'gj',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'rejected');
		expect(await getPostBySlug(blogId, r.version.slug)).toBeNull();
	});

	it('serves a published post by slug, then hides it once archived', async () => {
		const owner = await makeUser({ username: 'gate-pub' });
		const { id: blogId } = await makeBlogWith({ owner });
		const r = await createPost({
			blogId,
			title: 'Live Post',
			content: 'body',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'gp',
			status: 'under_review'
		});
		await setPostStatus(r.post.id, r.version.id, 'published');

		const got = await getPostBySlug(blogId, r.version.slug);
		expect(got).not.toBeNull();
		expect(got?.post.id).toBe(r.post.id);

		// Moderator archives it -> public slug loader must 404 (return null).
		await archivePost(r.post.id);
		expect(await getPostBySlug(blogId, r.version.slug)).toBeNull();
	});
});

describe('public listings exclude archived posts', () => {
	it('listPublishedPosts drops an archived post but keeps live ones', async () => {
		const owner = await makeUser({ username: 'list-arch' });
		const { id: blogId } = await makeBlogWith({ owner });

		const live = await createPost({
			blogId,
			title: 'Stays Up',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'lu',
			status: 'under_review'
		});
		await setPostStatus(live.post.id, live.version.id, 'published');

		const archived = await createPost({
			blogId,
			title: 'Gets Hidden',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'gh',
			status: 'under_review'
		});
		await setPostStatus(archived.post.id, archived.version.id, 'published');

		// Both visible before archiving.
		const before = await listPublishedPosts(blogId);
		expect(before.map((p) => p.id).sort()).toEqual([live.post.id, archived.post.id].sort());

		await archivePost(archived.post.id);

		const after = await listPublishedPosts(blogId);
		expect(after.map((p) => p.id)).toEqual([live.post.id]);
	});

	it('listPublishedPostsPage drops an archived post', async () => {
		const owner = await makeUser({ username: 'page-arch' });
		const { id: blogId } = await makeBlogWith({ owner });

		const a = await createPost({
			blogId,
			title: 'Page A',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'pa',
			status: 'under_review'
		});
		await setPostStatus(a.post.id, a.version.id, 'published');

		const b = await createPost({
			blogId,
			title: 'Page B',
			content: 'c',
			proof: {},
			snapshotRoot: 'r',
			nullifier: 'pb',
			status: 'under_review'
		});
		await setPostStatus(b.post.id, b.version.id, 'published');

		await archivePost(b.post.id);

		const page = await listPublishedPostsPage(blogId, { limit: 50 });
		expect(page.items.map((p) => p.id)).toEqual([a.post.id]);
	});
});
