import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { finishRegistration } from '$lib/server/webauthn';
import { createSession, setSessionCookie } from '$lib/server/session';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { randomToken } from '$lib/server/session';
import { sendMail } from '$lib/server/email';
import { env as publicEnv } from '$env/dynamic/public';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';

const Body = z.object({
	user_id: z.string().uuid(),
	response: z.any(),
	nickname: z.string().max(80).optional()
});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.authFinish, event, { keyBy: 'ip' });
	const { request, cookies, getClientAddress } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	try {
		await finishRegistration({
			userId: parsed.data.user_id,
			response: parsed.data.response,
			nickname: parsed.data.nickname
		});
	} catch (e) {
		throw error(400, (e as Error).message);
	}

	const userRows = await db
		.select()
		.from(schema.users)
		.where(eq(schema.users.id, parsed.data.user_id))
		.limit(1);
	const user = userRows[0];
	if (!user) throw error(404, 'user vanished');

	// Send the verification email if the address isn't verified yet.
	if (user.email && !user.emailVerifiedAt) {
		const token = randomToken();
		await db.insert(schema.emailVerifications).values({
			token,
			userId: user.id,
			email: user.email,
			expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24)
		});
		const origin = publicEnv.PUBLIC_ORIGIN ?? '';
		await sendMail({
			to: user.email,
			subject: 'Verify your Freed.Ink email',
			text: `Open this link to verify: ${origin}/api/auth/email/verify?token=${token}`
		});
	}

	const sessionId = await createSession(user.id, {
		userAgent: request.headers.get('user-agent'),
		ip: getClientAddress()
	});
	setSessionCookie(cookies, sessionId);

	await audit(event, {
		event: 'passkey.added',
		actorUserId: user.id,
		subjectUserId: user.id,
		metadata: { via: 'register' }
	});
	await audit(event, {
		event: 'session.created',
		actorUserId: user.id,
		subjectUserId: user.id,
		metadata: { method: 'passkey', new_user: true }
	});

	return json({ ok: true, user_id: user.id });
};
