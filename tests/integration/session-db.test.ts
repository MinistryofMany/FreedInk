import { describe, it, expect } from 'vitest';
import {
	createSession,
	loadSessionUser,
	destroySession,
	packCookie,
	reapExpiredSessions
} from '$lib/server/session';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { makeUser } from '../setup/factories';

describe('session DB roundtrip', () => {
	it('creates a session row and loads the user back via cookie', async () => {
		const u = await makeUser({ username: 'sessuser' });
		const sid = await createSession(u.id, { userAgent: 'vitest', ip: '127.0.0.1' });
		const cookie = packCookie(sid);
		const loaded = await loadSessionUser(cookie);
		expect(loaded?.id).toBe(u.id);
		expect(loaded?.username).toBe(u.username);
	});

	it('returns null for a tampered cookie', async () => {
		const u = await makeUser({ username: 'sess2' });
		const sid = await createSession(u.id, { userAgent: null, ip: null });
		const cookie = packCookie(sid);
		const tampered = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');
		expect(await loadSessionUser(tampered)).toBeNull();
	});

	it('returns null when the cookie is empty / missing', async () => {
		expect(await loadSessionUser(undefined)).toBeNull();
		expect(await loadSessionUser('')).toBeNull();
		expect(await loadSessionUser('no-dot-here')).toBeNull();
	});

	it('returns null after destroySession and removes the row', async () => {
		const u = await makeUser({ username: 'sess3' });
		const sid = await createSession(u.id, {});
		const cookie = packCookie(sid);
		await destroySession(cookie);
		expect(await loadSessionUser(cookie)).toBeNull();
		const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid));
		expect(rows).toHaveLength(0);
	});

	it('expired session is rejected AND removed lazily', async () => {
		const u = await makeUser({ username: 'sess4' });
		const sid = await createSession(u.id, {});
		// Move expiry into the past directly in the DB.
		await db
			.update(schema.sessions)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.sessions.id, sid));
		const cookie = packCookie(sid);
		expect(await loadSessionUser(cookie)).toBeNull();
		const rows = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid));
		expect(rows).toHaveLength(0);
	});

	it('lastSeenAt bumps on load', async () => {
		const u = await makeUser({ username: 'sess5' });
		const sid = await createSession(u.id, {});
		const before = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid)))[0]
			.lastSeenAt;
		await new Promise((r) => setTimeout(r, 20));
		await loadSessionUser(packCookie(sid));
		const after = (await db.select().from(schema.sessions).where(eq(schema.sessions.id, sid)))[0]
			.lastSeenAt;
		expect(after.getTime()).toBeGreaterThan(before.getTime());
	});

	it('reapExpiredSessions removes only expired rows', async () => {
		const u = await makeUser({ username: 'sess6' });
		const liveSid = await createSession(u.id, {});
		const deadSid = await createSession(u.id, {});
		await db
			.update(schema.sessions)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.sessions.id, deadSid));
		await reapExpiredSessions();
		const remaining = await db.select().from(schema.sessions);
		expect(remaining.map((r) => r.id).sort()).toEqual([liveSid].sort());
	});
});
