// API tests for POST /api/blog/settings. Auth + role + validation gates.
import { describe, it, expect } from 'vitest';
import { asUser, postJSON } from './helpers';
import { makeUser, makeBlogWith } from '../setup/factories';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';

describe('POST /api/blog/settings', () => {
	it('unauth → 401', async () => {
		const res = await postJSON('/api/blog/settings', {
			blog_id: '00000000-0000-0000-0000-000000000000',
			description: 'x'
		});
		expect(res.status).toBe(401);
	});

	it('invalid blog_id (not uuid) → 422', async () => {
		const u = await makeUser({ username: 'u', seed: 'u-422' });
		const { cookie } = await asUser(u);
		const res = await postJSON(
			'/api/blog/settings',
			{ blog_id: 'not-a-uuid', description: 'x' },
			{ cookie }
		);
		expect(res.status).toBe(422);
	});

	it('owner can update threshold and description → 200', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-200' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);

		const res = await postJSON(
			'/api/blog/settings',
			{
				blog_id: blog.id,
				approval_numerator: 1,
				approval_denominator: 4,
				description: 'a new description'
			},
			{ cookie }
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.blog.approval_numerator).toBe(1);
		expect(json.blog.approval_denominator).toBe(4);
		expect(json.blog.description).toBe('a new description');

		// DB-side check.
		const row = await db.select().from(schema.blogs).where(eq(schema.blogs.id, blog.id)).limit(1);
		expect(row[0].approvalNumerator).toBe(1);
		expect(row[0].approvalDenominator).toBe(4);
	});

	it('non-owner (commenter) → 403', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-403' });
		const commenter = await makeUser({ username: 'c', seed: 'c-403' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: commenter, role: 'commenter' }]
		});
		const sess = await asUser(commenter);
		const res = await postJSON(
			'/api/blog/settings',
			{ blog_id: blog.id, description: 'nope' },
			{ cookie: sess.cookie }
		);
		expect(res.status).toBe(403);
	});

	it('editor (non-owner role in writing set) still → 403 (managing is owner-only)', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-ed' });
		const editor = await makeUser({ username: 'ed', seed: 'ed-403' });
		const blog = await makeBlogWith({
			owner,
			members: [{ user: editor, role: 'editor' }]
		});
		const sess = await asUser(editor);
		const res = await postJSON(
			'/api/blog/settings',
			{ blog_id: blog.id, approval_numerator: 1, approval_denominator: 2 },
			{ cookie: sess.cookie }
		);
		expect(res.status).toBe(403);
	});

	it('invalid threshold (num > den) → 422', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-422-th' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/settings',
			{ blog_id: blog.id, approval_numerator: 5, approval_denominator: 3 },
			{ cookie }
		);
		expect(res.status).toBe(422);
	});

	it('threshold = 0 → 422 (zod-level)', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-422-zero' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/settings',
			{ blog_id: blog.id, approval_numerator: 0, approval_denominator: 3 },
			{ cookie }
		);
		expect(res.status).toBe(422);
	});

	it('unknown blog → 404', async () => {
		const u = await makeUser({ username: 'u', seed: 'u-404' });
		const { cookie } = await asUser(u);
		const res = await postJSON(
			'/api/blog/settings',
			{ blog_id: '00000000-0000-0000-0000-000000000000', description: 'x' },
			{ cookie }
		);
		expect(res.status).toBe(404);
	});

	it('title change updates slug', async () => {
		const owner = await makeUser({ username: 'owner', seed: 'o-title' });
		const blog = await makeBlogWith({ owner, title: 'Before Title' });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/settings',
			{ blog_id: blog.id, title: 'After Title' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.blog.title).toBe('After Title');
		expect(json.blog.slug).toBe('after-title');
	});
});
