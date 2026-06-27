// API tests for POST /api/blog/post/edit. Covers the happy path (real proof
// against the edit scope produces a new version) and the auth/zod gates.
import { describe, it, expect } from 'vitest';
import { asUser, postJSON } from './helpers';
import { makeUser, makeBlogWith, buildTestProof } from '../setup/factories';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';

const stubProof = {
	merkleTreeDepth: 1,
	merkleTreeRoot: '0',
	nullifier: '0',
	message: '0',
	scope: '0',
	points: []
};

describe('POST /api/blog/post/edit', () => {
	it('no cookie → NOT 401 (session-free, Phase 4): unknown version → 404', async () => {
		// Edit is session-free; authorization is the writers proof. With no session
		// AND an unknown version the request fails at resolution (404), never at an
		// auth gate — the session is no longer consulted.
		const res = await postJSON('/api/blog/post/edit', {
			post_version_id: '00000000-0000-0000-0000-000000000000',
			title: 't',
			content: 'c',
			proof: stubProof
		});
		expect(res.status).not.toBe(401);
		expect(res.status).toBe(404);
	});

	it('missing proof field → 422', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o' });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/post/edit',
			{
				post_version_id: '00000000-0000-0000-0000-000000000000',
				title: 't',
				content: 'c'
				// no proof
			},
			{ cookie }
		);
		expect(res.status).toBe(422);
	});

	it('a non-writer cannot edit: no valid writers proof → 400 (authz is the proof, Phase 4)', async () => {
		// Owner creates a post; a commenter (not in the writers tree) tries to edit.
		// Session no longer gates this — authorization is the writers proof. A
		// commenter can't produce a valid writers-tree proof, so the stub proof
		// fails verification → 400 (not a 403 role gate). Even WITH a session the
		// session is ignored.
		const owner = await makeUser({ username: 'owner', seed: 'o-403' });
		const commenter = await makeUser({ username: 'commenter', seed: 'c-403' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: commenter, role: 'commenter' }]
		});
		const createProof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'Hello\n\nbody'
		});
		const ownerSess = await asUser(owner);
		const created = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'Hello',
				content: 'body',
				proof: createProof,
				submit_for_review: false
			},
			{ cookie: ownerSess.cookie }
		);
		expect(created.status).toBe(200);
		const { version_id } = await created.json();

		// commenter tries to edit with a bogus proof (they have no writers proof).
		const commenterSess = await asUser(commenter);
		const res = await postJSON(
			'/api/blog/post/edit',
			{
				post_version_id: version_id,
				title: 'Sneaky',
				content: 'edited',
				proof: stubProof,
				submit_for_review: false
			},
			{ cookie: commenterSess.cookie }
		);
		expect(res.status).toBe(400);
	}, 60_000);

	it('creates a new version on success with a real proof', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-edit' });
		const blog = await makeBlogWith({ owner });
		const ownerSess = await asUser(owner);

		// Create the post first (version 1).
		const createProof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'Original Title\n\nOriginal body'
		});
		const created = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'Original Title',
				content: 'Original body',
				proof: createProof,
				submit_for_review: false
			},
			{ cookie: ownerSess.cookie }
		);
		expect(created.status).toBe(200);
		const { post_id, version_id } = await created.json();

		// Now edit → new version 2. Scope MUST match the server's expectation:
		//   edit:<post_id>:<next_version_number>
		const newTitle = 'Updated Title';
		const newContent = 'Updated body';
		const editProof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `edit:${post_id}:2`,
			message: `${newTitle}\n\n${newContent}`
		});
		const res = await postJSON(
			'/api/blog/post/edit',
			{
				post_version_id: version_id,
				title: newTitle,
				content: newContent,
				proof: editProof,
				submit_for_review: true
			},
			{ cookie: ownerSess.cookie }
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.post_id).toBe(post_id);
		expect(json.version).toBe(2);
		expect(json.version_id).not.toBe(version_id);

		// DB-side: post points at the new version, status moved to under_review,
		// and the old version row is still present.
		const post = await db
			.select()
			.from(schema.blogPosts)
			.where(eq(schema.blogPosts.id, post_id))
			.limit(1);
		expect(post[0].currentVersionId).toBe(json.version_id);
		expect(post[0].status).toBe('under_review');

		const versions = await db
			.select()
			.from(schema.blogPostVersions)
			.where(eq(schema.blogPostVersions.postId, post_id));
		expect(versions.length).toBe(2);
	}, 120_000);

	it('rejects when proof scope does not include version number → 400', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-bad-scope' });
		const blog = await makeBlogWith({ owner });
		const ownerSess = await asUser(owner);
		const createProof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `post:${blog.id}`,
			message: 'T\n\nc'
		});
		const created = await postJSON(
			'/api/blog/post',
			{
				blog_slug: blog.slug,
				title: 'T',
				content: 'c',
				proof: createProof,
				submit_for_review: false
			},
			{ cookie: ownerSess.cookie }
		);
		const { post_id, version_id } = await created.json();

		// Wrong scope (missing version number suffix).
		const badProof = await buildTestProof({
			blogId: blog.id,
			identity: owner.identity,
			scope: `edit:${post_id}`,
			message: 'T2\n\nc2'
		});
		const res = await postJSON(
			'/api/blog/post/edit',
			{
				post_version_id: version_id,
				title: 'T2',
				content: 'c2',
				proof: badProof,
				submit_for_review: false
			},
			{ cookie: ownerSess.cookie }
		);
		expect(res.status).toBe(400);
	}, 120_000);
});
