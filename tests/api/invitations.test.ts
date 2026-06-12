// API tests for the invitation routes (/api/blog/invite{,/[id]},
// /api/invite/[token]{,/accept}).
//
// Note: the integration setupFile (`tests/setup/integration.ts`) registers a
// beforeEach that does a full resetDb between tests, so each test starts with
// an empty database — including an empty rate_limits table, which means the
// rate-limit test below can use the full configured window cleanly.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, desc, eq } from 'drizzle-orm';
import { api, asUser, getJSON, postJSON, BASE_URL } from './helpers';
import { makeUser, makeBlogWith } from '../setup/factories';
import { createInvitation } from '$lib/db/invitations';
import { RULES } from '$lib/server/rate-limit';

describe('POST /api/blog/invite', () => {
	it('returns 401 when not signed in', async () => {
		const res = await postJSON('/api/blog/invite', {
			blog_id: '00000000-0000-0000-0000-000000000000',
			email: 'a@x.com',
			role: 'author'
		});
		expect(res.status).toBe(401);
	});

	it('owner can send an invite; creates a row and audits "invited" stage', async () => {
		const owner = await makeUser({ username: 'inv-owner' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);

		const res = await postJSON(
			'/api/blog/invite',
			{ blog_id: blog.id, email: 'NewBie@example.COM', role: 'reviewer' },
			{ cookie }
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.invitation_id).toMatch(/^[0-9a-f-]{36}$/);

		const rows = await db
			.select()
			.from(schema.blogInvitations)
			.where(eq(schema.blogInvitations.id, json.invitation_id));
		expect(rows[0].email).toBe('newbie@example.com');
		expect(rows[0].role).toBe('reviewer');

		// Audit row.
		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.actorUserId, owner.id))
			.orderBy(desc(schema.auditLog.createdAt))
			.limit(1);
		expect(audits[0].event).toBe('blog.member_added');
		expect(audits[0].subjectBlogId).toBe(blog.id);
		expect((audits[0].metadata as Record<string, unknown>).stage).toBe('invited');
	});

	it('non-owner is rejected with 403', async () => {
		const owner = await makeUser({ username: 'inv-owner2' });
		const editor = await makeUser({ username: 'inv-editor' });
		const blog = await makeBlogWith({ owner, members: [{ user: editor, role: 'editor' }] });
		const { cookie } = await asUser(editor);
		const res = await postJSON(
			'/api/blog/invite',
			{ blog_id: blog.id, email: 'x@x.com', role: 'author' },
			{ cookie }
		);
		expect(res.status).toBe(403);
	});

	it('rate-limits past the inviteSend threshold', async () => {
		const owner = await makeUser({ username: 'inv-rl' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);

		const max = RULES.inviteSend.max;
		for (let i = 0; i < max; i++) {
			const res = await postJSON(
				'/api/blog/invite',
				{ blog_id: blog.id, email: `rl-${i}@x.com`, role: 'author' },
				{ cookie }
			);
			await res.text();
			expect(res.status, `req #${i + 1}`).not.toBe(429);
		}
		const blocked = await postJSON(
			'/api/blog/invite',
			{ blog_id: blog.id, email: 'rl-last@x.com', role: 'author' },
			{ cookie }
		);
		await blocked.text();
		expect(blocked.status).toBe(429);
	});

	it('rejects bad body with 422', async () => {
		const owner = await makeUser({ username: 'inv-422' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const res = await postJSON(
			'/api/blog/invite',
			{ blog_id: blog.id, email: 'not-an-email', role: 'author' },
			{ cookie }
		);
		expect(res.status).toBe(422);
	});
});

describe('GET /api/blog/invite', () => {
	it('owner can list; non-owner gets 403', async () => {
		const owner = await makeUser({ username: 'list-o' });
		const editor = await makeUser({ username: 'list-e' });
		const blog = await makeBlogWith({ owner, members: [{ user: editor, role: 'editor' }] });
		await createInvitation({
			blogId: blog.id,
			invitedByUserId: owner.id,
			email: 'a@x.com',
			role: 'author'
		});

		const ownerSess = await asUser(owner);
		const ownerRes = await getJSON(`/api/blog/invite?blog_id=${blog.id}`, {
			cookie: ownerSess.cookie
		});
		expect(ownerRes.status).toBe(200);
		const json = await ownerRes.json();
		expect(json.invitations).toHaveLength(1);
		expect(json.invitations[0].email).toBe('a@x.com');

		const editorSess = await asUser(editor);
		const editorRes = await getJSON(`/api/blog/invite?blog_id=${blog.id}`, {
			cookie: editorSess.cookie
		});
		expect(editorRes.status).toBe(403);
	});
});

describe('GET /api/invite/[token]', () => {
	it('returns invitation context for an active token', async () => {
		const owner = await makeUser({ username: 'ctx-o' });
		const blog = await makeBlogWith({ owner, title: 'Ctx Blog' });
		const inv = await createInvitation({
			blogId: blog.id,
			invitedByUserId: owner.id,
			email: 'who@x.com',
			role: 'author'
		});
		const res = await getJSON(`/api/invite/${inv.token}`);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.blog_title).toBe('Ctx Blog');
		expect(json.role).toBe('author');
		expect(json.inviter_username).toBe('ctx-o');
	});

	it('returns 410 for an expired token', async () => {
		const owner = await makeUser({ username: 'exp-o' });
		const blog = await makeBlogWith({ owner });
		const inv = await createInvitation({
			blogId: blog.id,
			invitedByUserId: owner.id,
			email: 'who@x.com',
			role: 'author'
		});
		await db
			.update(schema.blogInvitations)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.blogInvitations.id, inv.id));
		const res = await getJSON(`/api/invite/${inv.token}`);
		expect(res.status).toBe(410);
	});

	it('returns 410 for a revoked token', async () => {
		const owner = await makeUser({ username: 'rev-o' });
		const blog = await makeBlogWith({ owner });
		const inv = await createInvitation({
			blogId: blog.id,
			invitedByUserId: owner.id,
			email: 'who@x.com',
			role: 'author'
		});
		await db
			.update(schema.blogInvitations)
			.set({ revokedAt: new Date() })
			.where(eq(schema.blogInvitations.id, inv.id));
		const res = await getJSON(`/api/invite/${inv.token}`);
		expect(res.status).toBe(410);
	});
});

describe('POST /api/invite/[token]/accept', () => {
	it('requires auth (401 when unsigned)', async () => {
		const owner = await makeUser({ username: 'acc-o' });
		const blog = await makeBlogWith({ owner });
		const inv = await createInvitation({
			blogId: blog.id,
			invitedByUserId: owner.id,
			email: 'who@x.com',
			role: 'author'
		});
		const res = await postJSON(`/api/invite/${inv.token}/accept`, {});
		expect(res.status).toBe(401);
	});

	it('adds the signed-in user with the invited role and audits the event', async () => {
		const owner = await makeUser({ username: 'acc-o' });
		const blog = await makeBlogWith({ owner });
		const invitee = await makeUser({ username: 'acc-invitee' });
		const inv = await createInvitation({
			blogId: blog.id,
			invitedByUserId: owner.id,
			email: 'acc-invitee@x.com',
			role: 'reviewer'
		});
		const { cookie } = await asUser(invitee);
		const res = await postJSON(`/api/invite/${inv.token}/accept`, {}, { cookie });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.blog_slug).toBe(blog.slug);
		expect(json.role).toBe('reviewer');

		// Audit row exists with via: invite.
		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(
				and(
					eq(schema.auditLog.actorUserId, invitee.id),
					eq(schema.auditLog.event, 'blog.member_added')
				)
			);
		expect(audits.length).toBeGreaterThan(0);
		const meta = audits[0].metadata as Record<string, unknown>;
		expect(meta.via).toBe('invite');
		expect(meta.role).toBe('reviewer');
	});
});

describe('DELETE /api/blog/invite/[id]', () => {
	it('owner can revoke; non-owner gets 403; unsigned gets 401', async () => {
		const owner = await makeUser({ username: 'del-o' });
		const editor = await makeUser({ username: 'del-e' });
		const blog = await makeBlogWith({ owner, members: [{ user: editor, role: 'editor' }] });
		const inv = await createInvitation({
			blogId: blog.id,
			invitedByUserId: owner.id,
			email: 'x@x.com',
			role: 'author'
		});

		// Unauth → 401
		const unauth = await api(`/api/blog/invite/${inv.id}`, { method: 'DELETE' });
		await unauth.text();
		expect(unauth.status).toBe(401);

		// Editor → 403
		const editorSess = await asUser(editor);
		const editorRes = await api(`${BASE_URL}/api/blog/invite/${inv.id}`, {
			method: 'DELETE',
			headers: { cookie: editorSess.cookie }
		});
		await editorRes.text();
		expect(editorRes.status).toBe(403);

		// Owner → 200, second call is a no-op (alreadyRevoked: true).
		const ownerSess = await asUser(owner);
		const r1 = await api(`${BASE_URL}/api/blog/invite/${inv.id}`, {
			method: 'DELETE',
			headers: { cookie: ownerSess.cookie }
		});
		expect(r1.status).toBe(200);
		const j1 = await r1.json();
		expect(j1.alreadyRevoked).toBe(false);

		const r2 = await api(`${BASE_URL}/api/blog/invite/${inv.id}`, {
			method: 'DELETE',
			headers: { cookie: ownerSess.cookie }
		});
		expect(r2.status).toBe(200);
		const j2 = await r2.json();
		expect(j2.alreadyRevoked).toBe(true);
	});
});
