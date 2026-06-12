// Platform-operator suspend/unsuspend endpoint. Sets users.suspended_at and
// optionally a reason; revokes all the user's sessions immediately so they're
// kicked out of every device. Reversible — unsuspending clears the column
// (their old sessions stay gone, they have to sign back in).
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { isPlatformOperator } from '$lib/server/operators';
import { revokeAllSessions } from '$lib/server/session';
import { audit } from '$lib/server/audit';

const Body = z.object({
	user_id: z.string().uuid(),
	suspend: z.boolean(),
	reason: z.string().max(500).optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	if (!isPlatformOperator(locals.user)) throw error(403, 'platform operator only');
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	if (parsed.data.user_id === locals.user.id) {
		throw error(409, "you can't suspend yourself");
	}

	const [target] = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.id, parsed.data.user_id))
		.limit(1);
	if (!target) throw error(404, 'user not found');

	if (parsed.data.suspend) {
		await db
			.update(schema.users)
			.set({
				suspendedAt: new Date(),
				suspendedReason: parsed.data.reason ?? null,
				updatedAt: new Date()
			})
			.where(eq(schema.users.id, parsed.data.user_id));
		const revoked = await revokeAllSessions(parsed.data.user_id);
		await audit(event, {
			event: 'user.suspended',
			subjectUserId: parsed.data.user_id,
			metadata: { reason: parsed.data.reason ?? null, sessions_revoked: revoked }
		});
	} else {
		await db
			.update(schema.users)
			.set({ suspendedAt: null, suspendedReason: null, updatedAt: new Date() })
			.where(eq(schema.users.id, parsed.data.user_id));
		await audit(event, {
			event: 'user.unsuspended',
			subjectUserId: parsed.data.user_id
		});
	}

	return json({ ok: true });
};
