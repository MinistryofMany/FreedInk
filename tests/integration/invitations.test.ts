// Integration tests for the invitation DB helpers in src/lib/db/invitations.ts.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull } from 'drizzle-orm';
import { createUserWithEmail } from '$lib/db/users';
import { createBlog } from '$lib/db/blogs';
import { setRole } from '$lib/db/members';
import {
	createInvitation,
	getInvitationByToken,
	acceptInvitation,
	listInvitations,
	revokeInvitation
} from '$lib/db/invitations';
describe('createInvitation', () => {
	it('persists with the right shape; sets a ~7d expiry and a unique token', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		const before = Date.now();
		const inv1 = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'Invitee@Example.COM',
			role: 'author'
		});
		const inv2 = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'someone-else@example.com',
			role: 'reviewer'
		});

		// Tokens differ even when issued back-to-back.
		expect(inv1.token).not.toEqual(inv2.token);
		expect(inv1.token.length).toBeGreaterThan(20);

		// expiresAt is in the future, roughly 7 days out.
		const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
		const skew = 10_000;
		const delta = inv1.expiresAt.getTime() - before;
		expect(delta).toBeGreaterThanOrEqual(sevenDaysMs - skew);
		expect(delta).toBeLessThanOrEqual(sevenDaysMs + skew);

		// Row in the table matches what we returned + email is lowercased.
		const row = await db
			.select()
			.from(schema.blogInvitations)
			.where(eq(schema.blogInvitations.id, inv1.id))
			.limit(1);
		expect(row[0].email).toBe('invitee@example.com');
		expect(row[0].role).toBe('author');
		expect(row[0].blogId).toBe(blogId);
		expect(row[0].invitedByUserId).toBe(owner.id);
		expect(row[0].acceptedAt).toBeNull();
		expect(row[0].revokedAt).toBeNull();
	});
});

describe('getInvitationByToken', () => {
	it('hydrates blog + inviter context for an active token', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId, slug } = await createBlog(owner.id, 'Cool Blog', null);

		const inv = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'a@x.com',
			role: 'author'
		});
		const ctx = await getInvitationByToken(inv.token);
		expect(ctx).not.toBeNull();
		expect(ctx?.blogTitle).toBe('Cool Blog');
		expect(ctx?.blogSlug).toBe(slug);
		expect(ctx?.inviterUsername).toBe('owner');
		expect(ctx?.role).toBe('author');
	});

	it('returns null for an unknown / expired / revoked / accepted token', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		expect(await getInvitationByToken('nope')).toBeNull();

		const expired = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'e@x.com',
			role: 'author'
		});
		await db
			.update(schema.blogInvitations)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.blogInvitations.id, expired.id));
		expect(await getInvitationByToken(expired.token)).toBeNull();

		const revoked = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'r@x.com',
			role: 'author'
		});
		await revokeInvitation(revoked.id, owner.id);
		expect(await getInvitationByToken(revoked.token)).toBeNull();

		const accepted = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'a@x.com',
			role: 'author'
		});
		const invitee = await createUserWithEmail('invitee@x.com', 'invitee');
		await acceptInvitation({ token: accepted.token, userId: invitee.id });
		expect(await getInvitationByToken(accepted.token)).toBeNull();
	});
});

describe('acceptInvitation', () => {
	it('creates a blog_members row with the invited role for an existing user', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		const invitee = await createUserWithEmail('inv@x.com', 'invitee');

		const inv = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'inv@x.com',
			role: 'reviewer'
		});
		const result = await acceptInvitation({ token: inv.token, userId: invitee.id });
		expect(result.role).toBe('reviewer');
		expect(result.alreadyMember).toBe(false);
		expect(result.blogId).toBe(blogId);

		const member = await db
			.select()
			.from(schema.blogMembers)
			.where(
				and(
					eq(schema.blogMembers.blogId, blogId),
					eq(schema.blogMembers.userId, invitee.id),
					isNull(schema.blogMembers.removedAt)
				)
			);
		expect(member).toHaveLength(1);
		expect(member[0].role).toBe('reviewer');

		// Invitation row is marked accepted.
		const rows = await db
			.select()
			.from(schema.blogInvitations)
			.where(eq(schema.blogInvitations.id, inv.id));
		expect(rows[0].acceptedAt).not.toBeNull();
		expect(rows[0].acceptedByUserId).toBe(invitee.id);
	});

	it('rejects a second accept on the same token (idempotency / replay)', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		const invitee = await createUserWithEmail('inv@x.com', 'invitee');

		const inv = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'inv@x.com',
			role: 'author'
		});
		await acceptInvitation({ token: inv.token, userId: invitee.id });
		await expect(acceptInvitation({ token: inv.token, userId: invitee.id })).rejects.toMatchObject({
			status: 410
		});
	});

	it('rejects a revoked token with 410', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		const invitee = await createUserWithEmail('inv@x.com', 'invitee');

		const inv = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'inv@x.com',
			role: 'author'
		});
		await revokeInvitation(inv.id, owner.id);
		await expect(acceptInvitation({ token: inv.token, userId: invitee.id })).rejects.toMatchObject({
			status: 410
		});
	});

	it('no-ops when user is already a member with the exact same role', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		const invitee = await createUserWithEmail('inv@x.com', 'invitee');
		// Pre-add as author at the same role we're about to invite to.
		await setRole(blogId, invitee.id, 'author', owner.id);

		const inv = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'inv@x.com',
			role: 'author'
		});
		const result = await acceptInvitation({ token: inv.token, userId: invitee.id });
		expect(result.alreadyMember).toBe(true);

		// Still exactly one active member row.
		const rows = await db
			.select()
			.from(schema.blogMembers)
			.where(
				and(
					eq(schema.blogMembers.blogId, blogId),
					eq(schema.blogMembers.userId, invitee.id),
					isNull(schema.blogMembers.removedAt)
				)
			);
		expect(rows).toHaveLength(1);
		// Invitation is still marked accepted.
		const inv2 = await db
			.select()
			.from(schema.blogInvitations)
			.where(eq(schema.blogInvitations.id, inv.id));
		expect(inv2[0].acceptedAt).not.toBeNull();
	});

	it('refuses to downgrade/upgrade — user already a member at a different role', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		const invitee = await createUserWithEmail('inv@x.com', 'invitee');
		await setRole(blogId, invitee.id, 'commenter', owner.id);

		const inv = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'inv@x.com',
			role: 'author'
		});
		await expect(acceptInvitation({ token: inv.token, userId: invitee.id })).rejects.toMatchObject({
			status: 409
		});

		// Invitation NOT marked accepted on this failure path.
		const rows = await db
			.select()
			.from(schema.blogInvitations)
			.where(eq(schema.blogInvitations.id, inv.id));
		expect(rows[0].acceptedAt).toBeNull();
		// Original role unchanged.
		const member = await db
			.select()
			.from(schema.blogMembers)
			.where(
				and(
					eq(schema.blogMembers.blogId, blogId),
					eq(schema.blogMembers.userId, invitee.id),
					isNull(schema.blogMembers.removedAt)
				)
			);
		expect(member[0].role).toBe('commenter');
	});
});

describe('listInvitations', () => {
	it('returns only pending by default; can include accepted + revoked', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);
		const invitee = await createUserWithEmail('inv@x.com', 'invitee');

		const pending = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'p@x.com',
			role: 'author'
		});
		const accepted = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'a@x.com',
			role: 'author'
		});
		const revoked = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'r@x.com',
			role: 'author'
		});
		await acceptInvitation({ token: accepted.token, userId: invitee.id });
		await revokeInvitation(revoked.id, owner.id);

		const pendingOnly = await listInvitations(blogId);
		expect(pendingOnly.map((i) => i.id)).toEqual([pending.id]);

		const all = await listInvitations(blogId, {
			includeAccepted: true,
			includeRevoked: true
		});
		expect(all.map((i) => i.id).sort()).toEqual([pending.id, accepted.id, revoked.id].sort());

		// accepted-by username is hydrated for the accepted one.
		const acceptedItem = all.find((i) => i.id === accepted.id);
		expect(acceptedItem?.acceptedByUsername).toBe('invitee');
	});
});

describe('revokeInvitation', () => {
	it('owner can revoke; non-owner cannot', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		const { id: blogId } = await createBlog(owner.id, 'B', null);

		const editor = await createUserWithEmail('e@x.com', 'editor');
		await setRole(blogId, editor.id, 'editor', owner.id);

		const inv = await createInvitation({
			blogId,
			invitedByUserId: owner.id,
			email: 'a@x.com',
			role: 'author'
		});

		// Editor isn't owner → 403.
		await expect(revokeInvitation(inv.id, editor.id)).rejects.toMatchObject({ status: 403 });

		// Owner succeeds.
		const r1 = await revokeInvitation(inv.id, owner.id);
		expect(r1).toEqual({ ok: true, alreadyRevoked: false });

		// Second call is a no-op (idempotent).
		const r2 = await revokeInvitation(inv.id, owner.id);
		expect(r2.alreadyRevoked).toBe(true);
	});

	it('throws 404 for an unknown invitation id', async () => {
		const owner = await createUserWithEmail('o@x.com', 'owner');
		await expect(
			revokeInvitation('00000000-0000-0000-0000-000000000000', owner.id)
		).rejects.toMatchObject({ status: 404 });
	});
});
