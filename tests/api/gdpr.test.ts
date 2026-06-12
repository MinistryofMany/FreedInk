// Coverage for /api/gdpr/{export,delete}. Verifies that the export ships
// the user's data without ciphertext / private keys, that delete requires an
// exact username confirmation, and that delete cascades correctly but leaves
// blogs the user owned intact (blogs do NOT cascade on owner deletion;
// blog_members rows do).
import { describe, it, expect } from 'vitest';
import { asUser, postJSON } from './helpers';
import { makeUser, makeBlogWith } from '../setup/factories';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';

describe('GDPR export', () => {
	it('rejects unauthenticated requests with 401', async () => {
		const res = await postJSON('/api/gdpr/export', {});
		expect(res.status).toBe(401);
	});

	it('returns the requesting user data as a downloadable JSON file', async () => {
		const user = await makeUser({ username: 'exporter' });
		const blog = await makeBlogWith({ owner: user, title: 'My Blog' });
		const { cookie } = await asUser(user);

		const res = await postJSON('/api/gdpr/export', {}, { cookie });
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type') ?? '').toMatch(/application\/json/);
		const cd = res.headers.get('content-disposition') ?? '';
		expect(cd).toMatch(/attachment/);
		expect(cd).toMatch(/freedink-export-/);
		expect(cd).toContain(user.id);

		const body = await res.json();
		expect(body.user.id).toBe(user.id);
		expect(body.user.username).toBe('exporter');
		expect(Array.isArray(body.wallets)).toBe(true);
		expect(Array.isArray(body.passkeys)).toBe(true);
		expect(Array.isArray(body.identities)).toBe(true);
		expect(Array.isArray(body.memberships)).toBe(true);
		expect(Array.isArray(body.sessions)).toBe(true);

		// Membership for the blog they own should appear.
		expect(body.memberships.some((m: { blogId: string }) => m.blogId === blog.id)).toBe(true);

		// Identity public fields present; ciphertext / salt / nonce / kdf-params NOT.
		expect(body.identities.length).toBeGreaterThan(0);
		const id0 = body.identities[0];
		expect(id0.idc).toBeTruthy();
		expect(id0.publicKey).toBeTruthy();
		expect(id0).not.toHaveProperty('ciphertext');
		expect(id0).not.toHaveProperty('kdfSalt');
		expect(id0).not.toHaveProperty('nonce');
		expect(id0).not.toHaveProperty('kdfParams');

		// No identity row carries a `ciphertext` field, and no fragment of the
		// encrypted-vault material leaks via another key. The word "ciphertext"
		// itself is permitted to appear in the top-level `notice` text that
		// explains the omission.
		for (const id of body.identities) {
			expect(Object.keys(id)).not.toContain('ciphertext');
			expect(Object.keys(id)).not.toContain('kdfSalt');
			expect(Object.keys(id)).not.toContain('nonce');
		}
		const dataOnly = JSON.stringify({
			user: body.user,
			wallets: body.wallets,
			passkeys: body.passkeys,
			identities: body.identities,
			memberships: body.memberships,
			sessions: body.sessions
		});
		expect(dataOnly).not.toMatch(/ciphertext/i);

		// Session row for the current session is present.
		expect(body.sessions.length).toBeGreaterThan(0);
		expect(body.sessions[0]).toHaveProperty('createdAt');
	});

	it('writes an audit row tagged gdpr.export', async () => {
		const user = await makeUser({ username: 'exporter2' });
		const { cookie } = await asUser(user);
		const res = await postJSON('/api/gdpr/export', {}, { cookie });
		expect(res.status).toBe(200);
		const rows = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.subjectUserId, user.id));
		expect(rows.some((r) => r.event === 'gdpr.export')).toBe(true);
	});
});

describe('GDPR delete', () => {
	it('rejects unauthenticated requests with 401', async () => {
		const res = await postJSON('/api/gdpr/delete', { confirm: 'whatever' });
		expect(res.status).toBe(401);
	});

	it('returns 422 when the confirmation does not match the username', async () => {
		const user = await makeUser({ username: 'tobedeleted' });
		const { cookie } = await asUser(user);
		const res = await postJSON('/api/gdpr/delete', { confirm: 'wrong' }, { cookie });
		expect(res.status).toBe(422);

		// User still exists.
		const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
		expect(rows.length).toBe(1);
	});

	it('returns 422 when the body is missing the confirm field', async () => {
		const user = await makeUser({ username: 'noconfirm' });
		const { cookie } = await asUser(user);
		const res = await postJSON('/api/gdpr/delete', {}, { cookie });
		expect(res.status).toBe(422);
	});

	it('cascades on match: user gone, sessions gone, owned blogs survive', async () => {
		const user = await makeUser({ username: 'goodbye' });
		const blog = await makeBlogWith({ owner: user, title: 'Survives Deletion' });
		const { cookie } = await asUser(user);

		// Sanity pre-state.
		const sessionsBefore = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, user.id));
		expect(sessionsBefore.length).toBeGreaterThan(0);
		const identitiesBefore = await db
			.select()
			.from(schema.userIdentities)
			.where(eq(schema.userIdentities.userId, user.id));
		expect(identitiesBefore.length).toBeGreaterThan(0);

		const res = await postJSON('/api/gdpr/delete', { confirm: 'goodbye' }, { cookie });
		expect(res.status).toBe(200);

		// User row deleted.
		const userRows = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
		expect(userRows.length).toBe(0);

		// Sessions for this user cascade away.
		const sessions = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, user.id));
		expect(sessions.length).toBe(0);

		// Identities also cascade.
		const identities = await db
			.select()
			.from(schema.userIdentities)
			.where(eq(schema.userIdentities.userId, user.id));
		expect(identities.length).toBe(0);

		// Memberships cascade.
		const members = await db
			.select()
			.from(schema.blogMembers)
			.where(eq(schema.blogMembers.userId, user.id));
		expect(members.length).toBe(0);

		// The blog itself survives — blogs don't depend on a single owner
		// surviving in the schema, and deleting them would orphan everyone
		// else's content.
		const blogRows = await db.select().from(schema.blogs).where(eq(schema.blogs.id, blog.id));
		expect(blogRows.length).toBe(1);

		// Audit row for the deletion was written before the cascade. After the
		// user delete the actor_user_id is set to NULL via FK ON DELETE SET NULL,
		// so we look it up by event + metadata.username instead.
		const audits = await db
			.select()
			.from(schema.auditLog)
			.where(eq(schema.auditLog.event, 'gdpr.deletion'));
		expect(
			audits.some((r) => (r.metadata as { username?: string } | null)?.username === 'goodbye')
		).toBe(true);
	});
});
