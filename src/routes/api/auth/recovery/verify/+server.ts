import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { lookupRecovery } from '$lib/server/recovery';

// Used by the /recover page to render "Recovering account for <email>" before
// initiating the WebAuthn ceremony. 404 = unknown token, 410 = token exists
// but is consumed or expired.
export const GET: RequestHandler = async ({ url }) => {
	const token = url.searchParams.get('token');
	if (!token) throw error(422, 'missing token');

	const valid = await lookupRecovery(token);
	if (valid) {
		return json({ valid: true, email: valid.user.email });
	}

	// Distinguish "no row" (404) from "row exists but expired/consumed" (410).
	const rows = await db
		.select({ consumedAt: schema.accountRecoveries.consumedAt })
		.from(schema.accountRecoveries)
		.where(eq(schema.accountRecoveries.token, token))
		.limit(1);
	if (rows.length === 0) throw error(404, 'unknown token');
	throw error(410, 'token expired or already used');
};
