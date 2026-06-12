// Register a Web Push subscription for the current user. UPSERT by endpoint
// because browsers re-subscribe transparently — the endpoint is a stable
// identifier the push service issues to (origin, user, browser instance).
// Same endpoint = same physical subscription; we just refresh keys + the
// last_seen timestamp so dormant rows look fresh again.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { audit } from '$lib/server/audit';

const Body = z.object({
	endpoint: z.string().url(),
	keys: z.object({
		p256dh: z.string().min(1),
		auth: z.string().min(1)
	}),
	userAgent: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	let raw: unknown;
	try {
		raw = await request.json();
	} catch {
		throw error(422, 'invalid JSON');
	}
	const parsed = Body.safeParse(raw);
	if (!parsed.success) throw error(422, parsed.error.message);
	const { endpoint, keys, userAgent } = parsed.data;

	// Use endpoint as the natural key. ON CONFLICT updates owner + keys + ts
	// so re-subscribing from the same browser dedupes, even if the previous
	// subscription was owned by a different user on the same device.
	await db
		.insert(schema.pushSubscriptions)
		.values({
			userId: locals.user.id,
			endpoint,
			p256dh: keys.p256dh,
			auth: keys.auth,
			userAgent: userAgent ?? request.headers.get('user-agent') ?? null
		})
		.onConflictDoUpdate({
			target: schema.pushSubscriptions.endpoint,
			set: {
				userId: locals.user.id,
				p256dh: keys.p256dh,
				auth: keys.auth,
				userAgent: userAgent ?? request.headers.get('user-agent') ?? null,
				lastSeenAt: new Date()
			}
		});

	await audit(event, {
		event: 'push.subscribed',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { endpoint_host: new URL(endpoint).host }
	});

	return json({ ok: true });
};
