// Focused test for revokeAllSessions — the helper backs both /api/auth/sessions
// (bulk revoke) and the post-recovery / post-rotate side effects.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import {
	createSession,
	revokeAllSessions,
	loadSessionUser,
	packCookie
} from '$lib/server/session';
import { makeUser } from '../setup/factories';

describe('revokeAllSessions', () => {
	it('creates two sessions, revokes all except one — one survives', async () => {
		const u = await makeUser({ username: 'rev-u' });
		const keep = await createSession(u.id, { userAgent: 'keep' });
		const drop = await createSession(u.id, { userAgent: 'drop' });

		const n = await revokeAllSessions(u.id, keep);
		expect(n).toBe(1);

		const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].id).toBe(keep);
		expect(await loadSessionUser(packCookie(keep))).not.toBeNull();
		expect(await loadSessionUser(packCookie(drop))).toBeNull();
	});

	it('drops every session when no exception is given', async () => {
		const u = await makeUser({ username: 'rev-u2' });
		await createSession(u.id, {});
		await createSession(u.id, {});
		await createSession(u.id, {});
		const n = await revokeAllSessions(u.id);
		expect(n).toBe(3);
		const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.userId, u.id));
		expect(rows).toHaveLength(0);
	});

	it("leaves other users' sessions alone", async () => {
		const a = await makeUser({ username: 'rev-a' });
		const b = await makeUser({ username: 'rev-b' });
		const sA = await createSession(a.id, {});
		const sB = await createSession(b.id, {});
		const n = await revokeAllSessions(a.id);
		expect(n).toBe(1);
		expect(await loadSessionUser(packCookie(sA))).toBeNull();
		expect(await loadSessionUser(packCookie(sB))).not.toBeNull();
	});

	it('returns 0 when the user has no sessions', async () => {
		const u = await makeUser({ username: 'rev-empty' });
		expect(await revokeAllSessions(u.id)).toBe(0);
	});
});
