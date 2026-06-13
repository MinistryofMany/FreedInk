// User list for platform operators. Derives last_seen_at from the most-recent
// non-expired session. "Suspend" sets users.suspended_at (+ an optional reason)
// and revokes every one of the user's sessions, mirroring
// /api/platform/users/suspend so both entry points behave identically. The
// account is locked out until an operator unsuspends it.
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { desc, eq, sql } from 'drizzle-orm';
import { revokeAllSessions } from '$lib/server/session';
import { audit } from '$lib/server/audit';
import { isPlatformOperator } from '$lib/server/operators';

const SuspendBody = z.object({
	user_id: z.string().uuid(),
	reason: z.string().max(500).optional()
});

export const load: PageServerLoad = async () => {
	const users = await db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			email: schema.users.email,
			createdAt: schema.users.createdAt,
			lastSeenAt: sql<Date | null>`(
				SELECT MAX(${schema.sessions.lastSeenAt})
				FROM ${schema.sessions}
				WHERE ${schema.sessions.userId} = ${schema.users.id}
			)`
		})
		.from(schema.users)
		.orderBy(desc(schema.users.createdAt));

	return { users };
};

export const actions: Actions = {
	// Suspend mirrors POST /api/platform/users/suspend (suspend: true): set
	// suspended_at + reason and revoke every session. Form actions skip the
	// parent layout load, so the operator gate is re-applied here.
	suspend: async (event) => {
		if (!isPlatformOperator(event.locals.user)) {
			return fail(403, { error: 'platform operator only' });
		}
		const operator = event.locals.user!;
		const form = await event.request.formData();
		const parsed = SuspendBody.safeParse({
			user_id: String(form.get('user_id') ?? ''),
			reason: form.get('reason') ? String(form.get('reason')) : undefined
		});
		if (!parsed.success) return fail(422, { error: 'user_id required' });

		if (parsed.data.user_id === operator.id) {
			return fail(409, { error: "you can't suspend yourself" });
		}

		const [target] = await db
			.select({ id: schema.users.id })
			.from(schema.users)
			.where(eq(schema.users.id, parsed.data.user_id))
			.limit(1);
		if (!target) return fail(404, { error: 'user not found' });

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
			actorUserId: operator.id,
			subjectUserId: parsed.data.user_id,
			metadata: { reason: parsed.data.reason ?? null, sessions_revoked: revoked }
		});
		return { ok: true, revoked };
	}
};
