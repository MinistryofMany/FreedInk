import type { RequestHandler } from './$types';
import { destroySession, clearSessionCookie, SESSION_COOKIE_NAME } from '$lib/server/session';
import { audit } from '$lib/server/audit';

export const POST: RequestHandler = async (event) => {
	const { cookies, locals } = event;
	const actor = locals.user?.id ?? null;
	await destroySession(cookies.get(SESSION_COOKIE_NAME));
	clearSessionCookie(cookies);
	if (actor) {
		await audit(event, {
			event: 'session.destroyed',
			actorUserId: actor,
			subjectUserId: actor
		});
	}
	return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
