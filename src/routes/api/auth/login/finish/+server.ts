import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { finishAuthentication } from '$lib/server/webauthn';
import { createSession, setSessionCookie } from '$lib/server/session';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';

const Body = z.object({
	response: z.any(),
	email: z.string().email().optional()
});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.authFinish, event, { keyBy: 'ip' });
	const { request, cookies, getClientAddress } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	let result;
	try {
		result = await finishAuthentication({
			response: parsed.data.response,
			email: parsed.data.email ?? null
		});
	} catch (e) {
		throw error(401, (e as Error).message);
	}

	const sessionId = await createSession(result.userId, {
		userAgent: request.headers.get('user-agent'),
		ip: getClientAddress()
	});
	setSessionCookie(cookies, sessionId);
	await audit(event, {
		event: 'session.created',
		actorUserId: result.userId,
		subjectUserId: result.userId,
		metadata: { method: 'passkey' }
	});
	return json({ ok: true, user_id: result.userId });
};
