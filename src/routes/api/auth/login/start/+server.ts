import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { startAuthentication } from '$lib/server/webauthn';
import { enforce, RULES } from '$lib/server/rate-limit';

const Body = z.object({
	email: z.string().email().optional()
});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.authStart, event, { keyBy: 'ip' });
	const { request } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	const options = await startAuthentication({ email: parsed.data.email ?? null });
	return json({ options });
};
