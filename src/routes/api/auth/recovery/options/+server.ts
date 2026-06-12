import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { startRegistration } from '$lib/server/webauthn';
import { lookupRecovery } from '$lib/server/recovery';

const Body = z.object({ token: z.string().min(1) });

// Returns WebAuthn registration options for the user the recovery token
// belongs to. Mirrors POST /api/auth/passkey/add but the auth gate is the
// recovery token instead of a session.
export const POST: RequestHandler = async ({ request }) => {
	const parsed = Body.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const valid = await lookupRecovery(parsed.data.token);
	if (!valid) throw error(410, 'token expired or already used');

	const existingCreds = await db
		.select({ credentialId: schema.passkeyCredentials.credentialId })
		.from(schema.passkeyCredentials)
		.where(eq(schema.passkeyCredentials.userId, valid.user.id));

	const options = await startRegistration({
		userId: valid.user.id,
		username: valid.user.username,
		excludeCredentialIds: existingCreds.map((c) => c.credentialId as Uint8Array)
	});

	return json({ options });
};
