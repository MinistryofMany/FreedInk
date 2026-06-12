// Integration tests for the push-notifications module.
//
// Two layers are exercised here:
//
//   1. The push_subscriptions table behaviour the API endpoint relies on —
//      an UPSERT on `endpoint` so a re-subscribe from the same browser
//      replaces (not duplicates) the row, and a scoped DELETE that only
//      touches rows owned by the calling user.
//
//   2. The sendPushToUser helper in `$lib/server/notifications`, with
//      web-push mocked so we don't make real HTTPS calls. We verify that
//      a 410 Gone response from the push service prunes the dead row from
//      the database.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { makeUser } from '../setup/factories';

const sendNotificationMock = vi.fn();

// Stub the VAPID helper so we never touch the on-disk `data/vapid.json` from
// integration tests — otherwise a fake/test key would leak into subsequent
// API tests that boot the real server.
vi.mock('$lib/server/vapid', () => ({
	getOrCreateVapidKeys: () => ({
		publicKey: 'BPublicKeyFake',
		privateKey: 'PrivateKeyFake',
		subject: 'mailto:test@freed.ink'
	}),
	_resetVapidCacheForTests: () => {}
}));

// Mock web-push BEFORE importing notifications, because notifications imports
// web-push at module-eval time.
vi.mock('web-push', () => {
	class WebPushError extends Error {
		statusCode: number;
		headers: Record<string, string>;
		body: string;
		endpoint: string;
		constructor(
			message: string,
			statusCode: number,
			headers: Record<string, string>,
			body: string,
			endpoint: string
		) {
			super(message);
			this.statusCode = statusCode;
			this.headers = headers;
			this.body = body;
			this.endpoint = endpoint;
		}
	}
	return {
		default: {
			sendNotification: sendNotificationMock,
			generateVAPIDKeys: () => ({
				publicKey: 'BPublicKeyFake',
				privateKey: 'PrivateKeyFake'
			}),
			WebPushError
		},
		sendNotification: sendNotificationMock,
		generateVAPIDKeys: () => ({
			publicKey: 'BPublicKeyFake',
			privateKey: 'PrivateKeyFake'
		}),
		WebPushError
	};
});

// Import after the mock so the helper picks up the stubbed sendNotification.
const { sendPushToUser } = await import('$lib/server/notifications');
const webpush = await import('web-push');

describe('push_subscriptions: upsert semantics', () => {
	beforeEach(() => {
		sendNotificationMock.mockReset();
	});

	it('a brand-new (user, endpoint) inserts a row', async () => {
		const u = await makeUser({ username: 'pu-1' });
		await db.insert(schema.pushSubscriptions).values({
			userId: u.id,
			endpoint: 'https://fcm.example/dev-1',
			p256dh: 'p256',
			auth: 'auth',
			userAgent: 'vitest'
		});
		const rows = await db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.userId, u.id));
		expect(rows).toHaveLength(1);
		expect(rows[0].endpoint).toBe('https://fcm.example/dev-1');
	});

	it('re-subscribing with the same endpoint updates instead of duplicating', async () => {
		const u = await makeUser({ username: 'pu-2' });
		const endpoint = 'https://fcm.example/dev-2';
		await db.insert(schema.pushSubscriptions).values({
			userId: u.id,
			endpoint,
			p256dh: 'p256-old',
			auth: 'auth-old',
			userAgent: 'old-ua'
		});
		// UPSERT: same endpoint, new keys + UA + last_seen.
		await db
			.insert(schema.pushSubscriptions)
			.values({
				userId: u.id,
				endpoint,
				p256dh: 'p256-new',
				auth: 'auth-new',
				userAgent: 'new-ua'
			})
			.onConflictDoUpdate({
				target: schema.pushSubscriptions.endpoint,
				set: {
					userId: u.id,
					p256dh: 'p256-new',
					auth: 'auth-new',
					userAgent: 'new-ua',
					lastSeenAt: new Date()
				}
			});
		const rows = await db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.endpoint, endpoint));
		expect(rows).toHaveLength(1);
		expect(rows[0].p256dh).toBe('p256-new');
		expect(rows[0].userAgent).toBe('new-ua');
	});

	it('a DELETE scoped to (endpoint, userId) removes only that row', async () => {
		const a = await makeUser({ username: 'pu-3a' });
		const b = await makeUser({ username: 'pu-3b' });
		await db.insert(schema.pushSubscriptions).values([
			{
				userId: a.id,
				endpoint: 'https://fcm.example/dev-3a',
				p256dh: 'p',
				auth: 'a'
			},
			{
				userId: b.id,
				endpoint: 'https://fcm.example/dev-3b',
				p256dh: 'p',
				auth: 'a'
			}
		]);
		const removed = await db
			.delete(schema.pushSubscriptions)
			.where(
				and(
					eq(schema.pushSubscriptions.endpoint, 'https://fcm.example/dev-3a'),
					eq(schema.pushSubscriptions.userId, a.id)
				)
			)
			.returning({ id: schema.pushSubscriptions.id });
		expect(removed).toHaveLength(1);
		const left = await db.select().from(schema.pushSubscriptions);
		expect(left).toHaveLength(1);
		expect(left[0].userId).toBe(b.id);
	});
});

describe('sendPushToUser', () => {
	beforeEach(() => {
		sendNotificationMock.mockReset();
	});

	it('is a no-op when the user has no subscriptions', async () => {
		const u = await makeUser({ username: 'spu-none' });
		await sendPushToUser(u.id, { title: 't', body: 'b' });
		// Allow microtasks to drain (helper fires-and-forgets internally).
		await new Promise((r) => setTimeout(r, 10));
		expect(sendNotificationMock).not.toHaveBeenCalled();
	});

	it('calls web-push.sendNotification once per subscription with the JSON payload', async () => {
		const u = await makeUser({ username: 'spu-many' });
		await db.insert(schema.pushSubscriptions).values([
			{
				userId: u.id,
				endpoint: 'https://fcm.example/spu-1',
				p256dh: 'p',
				auth: 'a'
			},
			{
				userId: u.id,
				endpoint: 'https://fcm.example/spu-2',
				p256dh: 'p',
				auth: 'a'
			}
		]);
		sendNotificationMock.mockResolvedValue({ statusCode: 201, body: '', headers: {} });
		await sendPushToUser(u.id, { title: 'Hello', body: 'World', url: '/x' });
		// Drain microtasks.
		await new Promise((r) => setTimeout(r, 20));
		expect(sendNotificationMock).toHaveBeenCalledTimes(2);
		const [, payloadJson] = sendNotificationMock.mock.calls[0];
		expect(JSON.parse(payloadJson)).toEqual({
			title: 'Hello',
			body: 'World',
			url: '/x'
		});
	});

	it('prunes the row when the push service returns 410 Gone', async () => {
		const u = await makeUser({ username: 'spu-410' });
		await db.insert(schema.pushSubscriptions).values({
			userId: u.id,
			endpoint: 'https://fcm.example/dead',
			p256dh: 'p',
			auth: 'a'
		});
		sendNotificationMock.mockRejectedValueOnce(
			new (webpush as unknown as { WebPushError: new (...a: unknown[]) => Error }).WebPushError(
				'gone',
				410,
				{},
				'',
				'https://fcm.example/dead'
			)
		);
		await sendPushToUser(u.id, { title: 't', body: 'b' });
		// The .catch() handler is async; wait for it to settle.
		await new Promise((r) => setTimeout(r, 50));
		const rows = await db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.userId, u.id));
		expect(rows).toHaveLength(0);
	});

	it('keeps the row on non-410 errors (transient failure)', async () => {
		const u = await makeUser({ username: 'spu-500' });
		await db.insert(schema.pushSubscriptions).values({
			userId: u.id,
			endpoint: 'https://fcm.example/flaky',
			p256dh: 'p',
			auth: 'a'
		});
		sendNotificationMock.mockRejectedValueOnce(
			new (webpush as unknown as { WebPushError: new (...a: unknown[]) => Error }).WebPushError(
				'server error',
				500,
				{},
				'',
				'https://fcm.example/flaky'
			)
		);
		await sendPushToUser(u.id, { title: 't', body: 'b' });
		await new Promise((r) => setTimeout(r, 50));
		const rows = await db
			.select()
			.from(schema.pushSubscriptions)
			.where(eq(schema.pushSubscriptions.userId, u.id));
		expect(rows).toHaveLength(1);
	});
});
