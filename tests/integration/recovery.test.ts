// Integration tests for account recovery. The WebAuthn ceremony itself is
// covered in the webauthn tests; here we focus on the recovery state machine
// (token issue, lookup, expiry, single-use, session-revoke side effect).
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull } from 'drizzle-orm';
import { startRecovery, lookupRecovery, consumeRecovery } from '$lib/server/recovery';
import { createSession, revokeAllSessions, loadSessionUser, packCookie } from '$lib/server/session';
import { startRegistration } from '$lib/server/webauthn';
import { makeUser } from '../setup/factories';
import { markEmailVerified } from '$lib/db/users';

async function activeRecoveries(userId: string) {
	return db
		.select()
		.from(schema.accountRecoveries)
		.where(
			and(eq(schema.accountRecoveries.userId, userId), isNull(schema.accountRecoveries.consumedAt))
		);
}

describe('recovery: startRecovery', () => {
	it('issues a token when email is verified', async () => {
		const u = await makeUser({ username: 'recv1', email: 'r1@x.com' });
		await markEmailVerified(u.id);
		const result = await startRecovery({
			email: 'r1@x.com',
			ip: '127.0.0.1',
			userAgent: 'vitest'
		});
		expect(result.issued).toBe(true);
		expect(result.token).toMatch(/^[A-Za-z0-9_-]+$/);
		const rows = await activeRecoveries(u.id);
		expect(rows).toHaveLength(1);
		expect(rows[0].token).toBe(result.token);
		expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
		expect(rows[0].requestedIp).toBe('127.0.0.1');
	});

	it('skips token issuance when the email is unverified', async () => {
		const u = await makeUser({ username: 'recv2', email: 'r2@x.com' });
		// Don't verify.
		const result = await startRecovery({ email: 'r2@x.com' });
		expect(result.issued).toBe(false);
		const rows = await activeRecoveries(u.id);
		expect(rows).toHaveLength(0);
	});

	it('returns issued:false (neutral) when email is unknown', async () => {
		const result = await startRecovery({ email: 'no-such-user@x.com' });
		expect(result.issued).toBe(false);
	});

	it('caps outstanding tokens per user (belt-and-suspenders)', async () => {
		const u = await makeUser({ username: 'recv3', email: 'r3@x.com' });
		await markEmailVerified(u.id);
		// 3 issued
		for (let i = 0; i < 3; i++) {
			expect((await startRecovery({ email: 'r3@x.com' })).issued).toBe(true);
		}
		// 4th refused
		expect((await startRecovery({ email: 'r3@x.com' })).issued).toBe(false);
	});
});

describe('recovery: lookupRecovery + consumeRecovery', () => {
	it('lookup returns null for unknown tokens', async () => {
		expect(await lookupRecovery('does-not-exist')).toBeNull();
	});

	it('lookup returns the row + user for valid tokens', async () => {
		const u = await makeUser({ username: 'recv4', email: 'r4@x.com' });
		await markEmailVerified(u.id);
		const { token } = await startRecovery({ email: 'r4@x.com' });
		const valid = await lookupRecovery(token!);
		expect(valid).not.toBeNull();
		expect(valid!.user.id).toBe(u.id);
		expect(valid!.user.email).toBe('r4@x.com');
	});

	it('lookup returns null when token expired', async () => {
		const u = await makeUser({ username: 'recv5', email: 'r5@x.com' });
		await markEmailVerified(u.id);
		const { token } = await startRecovery({ email: 'r5@x.com' });
		// Shove expiry into the past.
		await db
			.update(schema.accountRecoveries)
			.set({ expiresAt: new Date(Date.now() - 1000) })
			.where(eq(schema.accountRecoveries.token, token!));
		expect(await lookupRecovery(token!)).toBeNull();
	});

	it('lookup returns null after consume', async () => {
		const u = await makeUser({ username: 'recv6', email: 'r6@x.com' });
		await markEmailVerified(u.id);
		const { token } = await startRecovery({ email: 'r6@x.com' });
		expect(await consumeRecovery(token!)).toBe(true);
		expect(await lookupRecovery(token!)).toBeNull();
	});

	it('consume twice: first wins, second returns false', async () => {
		const u = await makeUser({ username: 'recv7', email: 'r7@x.com' });
		await markEmailVerified(u.id);
		const { token } = await startRecovery({ email: 'r7@x.com' });
		expect(await consumeRecovery(token!)).toBe(true);
		expect(await consumeRecovery(token!)).toBe(false);
	});
});

describe('recovery: WebAuthn options endpoint (server-side)', () => {
	it('returns registration options for the token user', async () => {
		const u = await makeUser({ username: 'recv8', email: 'r8@x.com' });
		await markEmailVerified(u.id);
		const { token } = await startRecovery({ email: 'r8@x.com' });
		const valid = await lookupRecovery(token!);
		expect(valid).not.toBeNull();
		// Mirror what /api/auth/recovery/options does: look up existing creds
		// and ask the server for fresh registration options.
		const options = await startRegistration({
			userId: valid!.user.id,
			username: valid!.user.username,
			excludeCredentialIds: []
		});
		expect(options.challenge).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(options.user.id).toBeTruthy();
		// And confirm a webauthn_challenges row was created.
		const challenges = await db
			.select()
			.from(schema.webauthnChallenges)
			.where(eq(schema.webauthnChallenges.userId, valid!.user.id));
		expect(challenges.length).toBeGreaterThanOrEqual(1);
	});
});

describe('recovery side effects: session revocation', () => {
	it('revokeAllSessions(user) wipes all sessions (no exception)', async () => {
		const u = await makeUser({ username: 'recv9', email: 'r9@x.com' });
		await markEmailVerified(u.id);
		const s1 = await createSession(u.id, {});
		const s2 = await createSession(u.id, {});
		const count = await revokeAllSessions(u.id);
		expect(count).toBe(2);
		expect(await loadSessionUser(packCookie(s1))).toBeNull();
		expect(await loadSessionUser(packCookie(s2))).toBeNull();
	});

	it('revokeAllSessions(user, exceptId) preserves one', async () => {
		const u = await makeUser({ username: 'recv10', email: 'r10@x.com' });
		const s1 = await createSession(u.id, {});
		const s2 = await createSession(u.id, {});
		const count = await revokeAllSessions(u.id, s2);
		expect(count).toBe(1);
		expect(await loadSessionUser(packCookie(s1))).toBeNull();
		expect(await loadSessionUser(packCookie(s2))).not.toBeNull();
	});

	it('end-to-end: recovery consume + revoke leaves only the new session alive', async () => {
		const u = await makeUser({ username: 'recv11', email: 'r11@x.com' });
		await markEmailVerified(u.id);
		// Pre-existing session on another (compromised?) device.
		const oldSid = await createSession(u.id, { userAgent: 'old-device' });

		const { token } = await startRecovery({ email: 'r11@x.com' });
		expect(await consumeRecovery(token!)).toBe(true);
		// Simulate what /finish does: mint new session, then revoke others.
		const newSid = await createSession(u.id, { userAgent: 'recovery-device' });
		await revokeAllSessions(u.id, newSid);

		const remaining = await db
			.select()
			.from(schema.sessions)
			.where(eq(schema.sessions.userId, u.id));
		expect(remaining).toHaveLength(1);
		expect(remaining[0].id).toBe(newSid);
		// Old session cookie no longer resolves.
		expect(await loadSessionUser(packCookie(oldSid))).toBeNull();
	});
});
