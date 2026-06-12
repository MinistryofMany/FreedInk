import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { startRegistration } from '$lib/server/webauthn';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const existing = await db
		.select({ credentialId: schema.passkeyCredentials.credentialId })
		.from(schema.passkeyCredentials)
		.where(eq(schema.passkeyCredentials.userId, locals.user.id));
	const options = await startRegistration({
		userId: locals.user.id,
		username: locals.user.username,
		excludeCredentialIds: existing.map((c) => c.credentialId as Uint8Array)
	});
	return json({ options });
};
