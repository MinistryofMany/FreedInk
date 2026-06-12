import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { getUserByEmail, getUserByUsername, createUserWithEmail } from '$lib/db/users';
import { startRegistration } from '$lib/server/webauthn';
import { enforce, RULES } from '$lib/server/rate-limit';

const Body = z.object({
	email: z.string().email(),
	username: z.string().min(3).max(40).regex(/^[a-zA-Z0-9_-]+$/)
});

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.authStart, event, { keyBy: 'ip' });
	const { request, locals } = event;
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	let user = locals.user;
	if (!user) {
		const existingByEmail = await getUserByEmail(parsed.data.email);
		if (existingByEmail) {
			// Existing account: registration here means "add another passkey" but
			// they aren't signed in. Force them to log in with the existing passkey first.
			throw error(409, 'account exists; sign in instead');
		}
		const existingByUsername = await getUserByUsername(parsed.data.username);
		if (existingByUsername) throw error(409, 'username taken');
		user = await createUserWithEmail(parsed.data.email, parsed.data.username);
	}

	const existingCreds = await db
		.select({ credentialId: schema.passkeyCredentials.credentialId })
		.from(schema.passkeyCredentials)
		.where(eq(schema.passkeyCredentials.userId, user.id));

	const options = await startRegistration({
		userId: user.id,
		username: user.username,
		excludeCredentialIds: existingCreds.map((c) => c.credentialId as Uint8Array)
	});

	return json({ user_id: user.id, options });
};
