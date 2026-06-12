// HTTP-level tests for the Web Push endpoints.
//   • /api/push/vapid is unauthenticated, returns a stable public key
//   • /api/push/subscribe requires a session, upserts on endpoint, audits
//   • /api/push/unsubscribe requires a session, deletes the matching row
import { describe, it, expect } from 'vitest';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { api, asUser, getJSON, postJSON } from './helpers';
import { makeUser } from '../setup/factories';

describe('GET /api/push/vapid', () => {
	it('responds with a base64-ish public key (no auth needed)', async () => {
		const res = await getJSON('/api/push/vapid');
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(typeof body.publicKey).toBe('string');
		expect(body.publicKey.length).toBeGreaterThan(20);
	});

	it('returns the same key on a repeat call (persisted between requests)', async () => {
		const a = await (await getJSON('/api/push/vapid')).json();
		const b = await (await getJSON('/api/push/vapid')).json();
		expect(a.publicKey).toBe(b.publicKey);
	});

	it('sets a cache-control header so the browser can cache the key', async () => {
		const res = await getJSON('/api/push/vapid');
		const cc = res.headers.get('cache-control') ?? '';
		expect(cc).toMatch(/max-age=\d+/);
	});
});

describe('POST /api/push/subscribe', () => {
	const validBody = {
		endpoint: 'https://fcm.example/sub-api-1',
		keys: { p256dh: 'p256dh-bytes', auth: 'auth-bytes' },
		userAgent: 'vitest-ua'
	};

	it('returns 401 when not signed in', async () => {
		const res = await postJSON('/api/push/subscribe', validBody);
		expect(res.status).toBe(401);
	});

	it('returns 422 on malformed body (missing endpoint)', async () => {
		const u = await makeUser({ username: 'push-malformed' });
		const { cookie } = await asUser(u);
		const res = await postJSON(
			'/api/push/subscribe',
			{ keys: { p256dh: 'a', auth: 'b' } },
			{ cookie }
		);
		expect(res.status).toBe(422);
	});

	it('returns 422 when JSON body is not parseable', async () => {
		const u = await makeUser({ username: 'push-badjson' });
		const { cookie } = await asUser(u);
		const res = await api('/api/push/subscribe', {
			method: 'POST',
			headers: { 'content-type': 'application/json', cookie },
			body: 'not json'
		});
		expect(res.status).toBe(422);
	});

	it('creates a row on first call and is idempotent on a repeat call', async () => {
		const u = await makeUser({ username: 'push-upsert' });
		const { cookie } = await asUser(u);

		const r1 = await postJSON('/api/push/subscribe', validBody, { cookie });
		expect(r1.status).toBe(200);

		const r2 = await postJSON(
			'/api/push/subscribe',
			{ ...validBody, keys: { p256dh: 'new-p256', auth: 'new-auth' } },
			{ cookie }
		);
		expect(r2.status).toBe(200);

		const rows = await db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.endpoint, validBody.endpoint));
		expect(rows).toHaveLength(1);
		expect(rows[0].userId).toBe(u.id);
		expect(rows[0].p256dh).toBe('new-p256');
	});
});

describe('POST /api/push/unsubscribe', () => {
	it('returns 401 when not signed in', async () => {
		const res = await postJSON('/api/push/unsubscribe', {
			endpoint: 'https://fcm.example/sub-api-2'
		});
		expect(res.status).toBe(401);
	});

	it('returns 422 on malformed body', async () => {
		const u = await makeUser({ username: 'push-unsub-malformed' });
		const { cookie } = await asUser(u);
		const res = await postJSON('/api/push/unsubscribe', {}, { cookie });
		expect(res.status).toBe(422);
	});

	it('deletes the matching subscription owned by the calling user', async () => {
		const u = await makeUser({ username: 'push-unsub-ok' });
		const { cookie } = await asUser(u);
		const endpoint = 'https://fcm.example/sub-api-3';
		await db.insert(schema.pushSubscriptions).values({
			userId: u.id,
			endpoint,
			p256dh: 'p',
			auth: 'a'
		});
		const res = await postJSON('/api/push/unsubscribe', { endpoint }, { cookie });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.removed).toBe(1);
		const rows = await db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.endpoint, endpoint));
		expect(rows).toHaveLength(0);
	});

	it('does not delete a subscription owned by a different user', async () => {
		const a = await makeUser({ username: 'push-unsub-a' });
		const b = await makeUser({ username: 'push-unsub-b' });
		const endpoint = 'https://fcm.example/sub-api-4';
		await db.insert(schema.pushSubscriptions).values({
			userId: a.id,
			endpoint,
			p256dh: 'p',
			auth: 'a'
		});
		// b tries to delete a's subscription
		const { cookie } = await asUser(b);
		const res = await postJSON('/api/push/unsubscribe', { endpoint }, { cookie });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.removed).toBe(0);
		const rows = await db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.endpoint, endpoint));
		expect(rows).toHaveLength(1);
		expect(rows[0].userId).toBe(a.id);
	});
});
