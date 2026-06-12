import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { z } from 'zod';
import { startRecovery } from '$lib/server/recovery';

const Body = z.object({
	email: z.string().email()
});

// Neutral response: never reveal whether the email is registered. Even on
// validation failure we 200 (with a sentinel) to keep the timing channel
// closed — callers who care about input shape should validate client-side.
const NEUTRAL = {
	ok: true,
	message: "If an account exists for that email, you'll receive a recovery link shortly."
};

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(NEUTRAL);
	}
	const parsed = Body.safeParse(body);
	if (!parsed.success) return json(NEUTRAL);

	await startRecovery({
		email: parsed.data.email,
		ip: getClientAddress(),
		userAgent: request.headers.get('user-agent')
	});

	return json(NEUTRAL);
};
