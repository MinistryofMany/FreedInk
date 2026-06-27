// Phase 6 — permissions PATCH endpoint + dual logging. Verifies:
//   - only a can_admin member may toggle capabilities (non-admin → 403);
//   - a toggle writes BOTH the internal audit_log AND the member-visible
//     permission_changes row;
//   - the last admin cannot be demoted (409);
//   - you can't change your own permissions (409);
//   - unauthenticated → 401.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { asUser, api } from './helpers';
import { makeUser, makeBlogWith } from '../setup/factories';

function patch(body: unknown, cookie?: string) {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (cookie) headers.cookie = cookie;
	return api('/api/blog/members', { method: 'PATCH', headers, body: JSON.stringify(body) });
}

describe('PATCH /api/blog/members (capabilities)', () => {
	it('an admin grants a capability → 200 and writes BOTH logs', async () => {
		const owner = await makeUser({ username: 'perm-owner' });
		const target = await makeUser({ username: 'perm-target' });
		const blog = await makeBlogWith({ owner, members: [{ user: target, role: 'commenter' }] });
		const { cookie } = await asUser(owner);

		const res = await patch(
			{ blog_id: blog.id, target: { username: 'perm-target' }, caps: { review: true } },
			cookie
		);
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.caps.review).toBe(true);

		// Internal audit_log row (attributed, operator view).
		const auditRows = await db
			.select()
			.from(schema.auditLog)
			.where(
				and(
					eq(schema.auditLog.subjectBlogId, blog.id),
					eq(schema.auditLog.event, 'blog.member_role_changed')
				)
			);
		expect(auditRows.length).toBeGreaterThanOrEqual(1);
		expect(auditRows.some((r) => r.actorUserId === owner.id)).toBe(true);

		// Member-visible permission_changes row.
		const changeRows = await db
			.select()
			.from(schema.permissionChanges)
			.where(eq(schema.permissionChanges.blogId, blog.id));
		expect(changeRows).toHaveLength(1);
		expect(changeRows[0].actorUserId).toBe(owner.id);
		expect(changeRows[0].subjectUserId).toBe(target.id);
		expect((changeRows[0].newCaps as { canReview: boolean }).canReview).toBe(true);
	});

	it('a non-admin member cannot toggle (403)', async () => {
		const owner = await makeUser({ username: 'na-owner' });
		const author = await makeUser({ username: 'na-author' });
		const target = await makeUser({ username: 'na-target' });
		const blog = await makeBlogWith({
			owner,
			members: [
				{ user: author, role: 'author' },
				{ user: target, role: 'commenter' }
			]
		});
		const { cookie } = await asUser(author); // author has no can_admin
		const res = await patch(
			{ blog_id: blog.id, target: { username: 'na-target' }, caps: { author: true } },
			cookie
		);
		expect(res.status).toBe(403);
	});

	it('the last admin is protected: demoting another admin is allowed, but the final admin can never be reached via the endpoint (self-guard backstop)', async () => {
		// Two admins. Admin A may demote admin B (one admin remains) — allowed.
		const owner = await makeUser({ username: 'last-owner' });
		const helper = await makeUser({ username: 'last-helper' });
		const blog = await makeBlogWith({ owner, members: [{ user: helper, role: 'owner' }] });
		const ownerSess = await asUser(owner);

		// owner demotes helper's admin: 2 admins → 1. Allowed.
		const demoteHelper = await patch(
			{ blog_id: blog.id, target: { username: 'last-helper' }, caps: { admin: false } },
			ownerSess.cookie
		);
		expect(demoteHelper.status).toBe(200);

		// owner is now the sole admin. The only way to remove can_admin from owner
		// via the endpoint is owner targeting themselves — blocked by the self-guard
		// (you can't change your own permissions). So the last admin is unreachable.
		const selfDemote = await patch(
			{ blog_id: blog.id, target: { username: 'last-owner' }, caps: { admin: false } },
			ownerSess.cookie
		);
		expect(selfDemote.status).toBe(409);

		// The data-layer last-admin guard (changeCapabilities) is exercised directly
		// in tests/integration/permissions.test.ts.
	});

	it('you cannot change your own permissions (409)', async () => {
		const owner = await makeUser({ username: 'self-owner' });
		const blog = await makeBlogWith({ owner });
		const { cookie } = await asUser(owner);
		const res = await patch(
			{ blog_id: blog.id, target: { username: 'self-owner' }, caps: { review: false } },
			cookie
		);
		expect(res.status).toBe(409);
	});

	it('unauthenticated → 401', async () => {
		const res = await patch({
			blog_id: '00000000-0000-0000-0000-000000000000',
			target: { username: 'x' },
			caps: { author: true }
		});
		expect(res.status).toBe(401);
	});
});
