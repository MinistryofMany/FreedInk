import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { finishRegistration } from '$lib/server/webauthn';
import {
	createSession,
	revokeAllSessions,
	setSessionCookie
} from '$lib/server/session';
import { consumeRecovery, lookupRecovery } from '$lib/server/recovery';
import { audit } from '$lib/server/audit';

const Body = z.object({
	token: z.string().min(1),
	response: z.any(),
	nickname: z.string().max(80).optional()
});

export const POST: RequestHandler = async (event) => {
	const { request, cookies, getClientAddress } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const valid = await lookupRecovery(parsed.data.token);
	if (!valid) throw error(410, 'token expired or already used');

	try {
		await finishRegistration({
			userId: valid.user.id,
			response: parsed.data.response,
			nickname: parsed.data.nickname ?? 'recovery'
		});
	} catch (e) {
		throw error(400, (e as Error).message);
	}

	// Mark the token consumed BEFORE issuing the session. If the consume call
	// races (e.g. two parallel finishes with the same token), only one wins.
	const consumed = await consumeRecovery(parsed.data.token);
	if (!consumed) throw error(410, 'token expired or already used');

	const sessionId = await createSession(valid.user.id, {
		userAgent: request.headers.get('user-agent'),
		ip: getClientAddress()
	});
	setSessionCookie(cookies, sessionId);

	// Security: assume the account may be compromised — drop every other
	// session for this user so any attacker who still holds one is kicked.
	await revokeAllSessions(valid.user.id, sessionId);

	await audit(event, {
		event: 'recovery.completed',
		actorUserId: valid.user.id,
		subjectUserId: valid.user.id,
		metadata: { token_age_ms: Date.now() - valid.row.createdAt.getTime() }
	});
	await audit(event, {
		event: 'passkey.added',
		actorUserId: valid.user.id,
		subjectUserId: valid.user.id,
		metadata: { via: 'recovery' }
	});
	await audit(event, {
		event: 'session.created',
		actorUserId: valid.user.id,
		subjectUserId: valid.user.id,
		metadata: { via: 'recovery' }
	});

	return json({ ok: true, user_id: valid.user.id });
};
