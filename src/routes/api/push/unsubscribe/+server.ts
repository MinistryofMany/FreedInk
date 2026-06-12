// Remove a Web Push subscription. Scoped to (endpoint, current user) so a
// guessed/leaked endpoint can't be used to wipe somebody else's subscription
// — the DELETE just returns ok=true with zero rows touched.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { db, schema } from '$lib/db/client';
import { audit } from '$lib/server/audit';

const Body = z.object({
	endpoint: z.string().url()
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
	const { endpoint } = parsed.data;

	const deleted = await db
		.delete(schema.pushSubscriptions)
		.where(
			and(
				eq(schema.pushSubscriptions.endpoint, endpoint),
				eq(schema.pushSubscriptions.userId, locals.user.id)
			)
		)
		.returning({ id: schema.pushSubscriptions.id });

	if (deleted.length > 0) {
		await audit(event, {
			event: 'push.unsubscribed',
			actorUserId: locals.user.id,
			subjectUserId: locals.user.id,
			metadata: { endpoint_host: new URL(endpoint).host }
		});
	}

	return json({ ok: true, removed: deleted.length });
};
