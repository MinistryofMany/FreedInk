// User list for platform operators. Derives last_seen_at from the most-recent
// non-expired session. "Suspend" here means revoke-all-sessions: it's a
// pragmatic stand-in for a true ban that would require schema changes (a
// users.suspended column) outside this wave's scope. The user can re-auth and
// come back; for repeat offenders the operator must escalate to GDPR delete
// or wait for a follow-up schema migration.
import type { Actions, PageServerLoad } from './$types';
import { fail } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { desc, eq, sql } from 'drizzle-orm';
import { revokeAllSessions } from '$lib/server/session';
import { audit } from '$lib/server/audit';

export const load: PageServerLoad = async () => {
	const users = await db
		.select({
			id: schema.users.id,
			username: schema.users.username,
			displayName: schema.users.displayName,
			email: schema.users.email,
			emailVerifiedAt: schema.users.emailVerifiedAt,
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
	suspend: async (event) => {
		const form = await event.request.formData();
		const userId = String(form.get('user_id') ?? '');
		if (!userId) return fail(422, { error: 'user_id required' });

		const revoked = await revokeAllSessions(userId);
		await audit(event, {
			event: 'session.revoked',
			actorUserId: event.locals.user!.id,
			subjectUserId: userId,
			metadata: { sessions_revoked: revoked, reason: 'platform_operator_suspension' }
		});
		return { ok: true, revoked };
	}
};
