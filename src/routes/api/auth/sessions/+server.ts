import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { and, eq, desc } from 'drizzle-orm';
import {
	SESSION_COOKIE_NAME,
	currentSessionId,
	destroySessionById
} from '$lib/server/session';
import { audit } from '$lib/server/audit';

export const GET: RequestHandler = async ({ locals, cookies }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const current = currentSessionId(cookies.get(SESSION_COOKIE_NAME));
	const rows = await db
		.select({
			id: schema.sessions.id,
			createdAt: schema.sessions.createdAt,
			lastSeenAt: schema.sessions.lastSeenAt,
			userAgent: schema.sessions.userAgent,
			ip: schema.sessions.ip
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.userId, locals.user.id))
		.orderBy(desc(schema.sessions.lastSeenAt));
	return json({
		sessions: rows.map((s) => ({
			id: s.id,
			createdAt: s.createdAt,
			lastSeenAt: s.lastSeenAt,
			userAgent: s.userAgent,
			ip: s.ip,
			current: s.id === current
		}))
	});
};

export const DELETE: RequestHandler = async (event) => {
	const { locals, url } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const id = url.searchParams.get('id');
	if (!id) throw error(422, 'missing id');

	// Confirm the session belongs to the calling user before revoking. We
	// scope on (id, userId) so a stolen or guessed UUID for someone else's
	// session is a no-op that returns 404.
	const rows = await db
		.select({ id: schema.sessions.id })
		.from(schema.sessions)
		.where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, locals.user.id)))
		.limit(1);
	if (rows.length === 0) throw error(404, 'session not found');

	await destroySessionById(id);
	await audit(event, {
		event: 'session.revoked',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { revoked_session_id: id }
	});
	return json({ ok: true });
};
