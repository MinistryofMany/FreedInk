// Phase 3 — per-device enroll + revoke endpoints (session-authenticated).
// Verifies: enroll allows MULTIPLE active devices (no single-active block),
// the device-revoke endpoint revokes one device, the last-active-device guard
// blocks revoking the only device, and you can't revoke another user's device.
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq, and } from 'drizzle-orm';
import { api, postJSON } from './helpers';
import { Identity } from '@semaphore-protocol/identity';

// A bare user with a session cookie but NO identity yet, so we drive the enroll
// endpoint from scratch (makeUser would pre-install one).
async function bareUserWithCookie(username: string) {
	const [u] = await db.insert(schema.users).values({ username }).returning();
	const { createSession, packCookie } = await import('$lib/server/session');
	const sid = await createSession(u.id, { userAgent: 'vitest', ip: '127.0.0.1' });
	return { id: u.id, cookie: `sid=${packCookie(sid)}` };
}

function blob(seed: string, deviceLabel?: string) {
	const id = new Identity(seed);
	return {
		idc: id.commitment.toString(),
		public_key: id.publicKey.toString(),
		ciphertext: 'AA',
		salt: 'AA',
		nonce: 'AA',
		kdf: 'pbkdf2-sha256' as const,
		kdf_params: { name: 'PBKDF2' as const, iterations: 600_000, hash: 'SHA-256' as const },
		...(deviceLabel ? { device_label: deviceLabel } : {})
	};
}

async function activeDevices(userId: string) {
	return db
		.select()
		.from(schema.userIdentities)
		.where(
			and(eq(schema.userIdentities.userId, userId), eq(schema.userIdentities.status, 'active'))
		);
}

describe('POST /api/identity (enroll)', () => {
	it('allows enrolling multiple active devices for one user', async () => {
		const u = await bareUserWithCookie('dev-multi');
		const r1 = await postJSON('/api/identity', blob('dev-multi-laptop', 'laptop'), {
			cookie: u.cookie
		});
		expect(r1.status).toBe(200);
		const r2 = await postJSON('/api/identity', blob('dev-multi-phone', 'phone'), {
			cookie: u.cookie
		});
		expect(r2.status).toBe(200);

		const devices = await activeDevices(u.id);
		expect(devices).toHaveLength(2);
		expect(devices.map((d) => d.deviceLabel).sort()).toEqual(['laptop', 'phone']);
	});

	it('GET returns all active blobs, newest first', async () => {
		const u = await bareUserWithCookie('dev-get');
		await postJSON('/api/identity', blob('dev-get-1', 'one'), { cookie: u.cookie });
		await postJSON('/api/identity', blob('dev-get-2', 'two'), { cookie: u.cookie });
		const res = await api('/api/identity', { headers: { cookie: u.cookie } });
		const json = await res.json();
		expect(json.identities).toHaveLength(2);
		// `identity` (back-compat single) is the newest.
		expect(json.identity.device_label).toBe('two');
	});

	it('rejects re-enrolling the same commitment (409)', async () => {
		const u = await bareUserWithCookie('dev-dup');
		const b = blob('dev-dup-1');
		expect((await postJSON('/api/identity', b, { cookie: u.cookie })).status).toBe(200);
		expect((await postJSON('/api/identity', b, { cookie: u.cookie })).status).toBe(409);
	});
});

describe('POST /api/identity/[id]/revoke', () => {
	it('revokes one device and leaves the other active', async () => {
		const u = await bareUserWithCookie('rev-multi');
		await postJSON('/api/identity', blob('rev-multi-a', 'a'), { cookie: u.cookie });
		await postJSON('/api/identity', blob('rev-multi-b', 'b'), { cookie: u.cookie });
		const devices = await activeDevices(u.id);
		const toRevoke = devices.find((d) => d.deviceLabel === 'b')!;

		const res = await api(`/api/identity/${toRevoke.id}/revoke`, {
			method: 'POST',
			headers: { cookie: u.cookie }
		});
		expect(res.status).toBe(200);

		const after = await activeDevices(u.id);
		expect(after).toHaveLength(1);
		expect(after[0].deviceLabel).toBe('a');
		// The revoked row is marked revoked with a timestamp.
		const revoked = await db
			.select()
			.from(schema.userIdentities)
			.where(eq(schema.userIdentities.id, toRevoke.id));
		expect(revoked[0].status).toBe('revoked');
		expect(revoked[0].revokedAt).toBeInstanceOf(Date);
	});

	it('blocks revoking the LAST active device (409 self-lockout guard)', async () => {
		const u = await bareUserWithCookie('rev-last');
		await postJSON('/api/identity', blob('rev-last-only', 'only'), { cookie: u.cookie });
		const [only] = await activeDevices(u.id);
		const res = await api(`/api/identity/${only.id}/revoke`, {
			method: 'POST',
			headers: { cookie: u.cookie }
		});
		expect(res.status).toBe(409);
		// Still active.
		expect(await activeDevices(u.id)).toHaveLength(1);
	});

	it("cannot revoke another user's device (404)", async () => {
		const owner = await bareUserWithCookie('rev-owner');
		await postJSON('/api/identity', blob('rev-owner-a', 'a'), { cookie: owner.cookie });
		await postJSON('/api/identity', blob('rev-owner-b', 'b'), { cookie: owner.cookie });
		const [dev] = await activeDevices(owner.id);

		const attacker = await bareUserWithCookie('rev-attacker');
		await postJSON('/api/identity', blob('rev-attacker-a', 'a'), { cookie: attacker.cookie });
		const res = await api(`/api/identity/${dev.id}/revoke`, {
			method: 'POST',
			headers: { cookie: attacker.cookie }
		});
		// The row isn't the attacker's → 404 (not found for this user).
		expect(res.status).toBe(404);
		// Owner's device untouched.
		expect(await activeDevices(owner.id)).toHaveLength(2);
	});

	it('requires a session (401)', async () => {
		const res = await api('/api/identity/00000000-0000-0000-0000-000000000000/revoke', {
			method: 'POST'
		});
		expect(res.status).toBe(401);
	});
});
