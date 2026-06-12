// GDPR / right-to-erasure. Permanently deletes the requesting user, cascading
// to sessions, passkeys, wallets, encrypted identity blobs, and blog
// memberships. Does NOT delete authored posts/comments — those carry
// unlinkable Semaphore proofs and have no FK to the user. Deleting them
// would (a) require knowing which ones were the user's, which we don't, and
// (b) break verifiability of historical proofs for other readers.
//
// We log the audit event BEFORE the delete (the delete sets actor_user_id to
// NULL via the FK ON DELETE SET NULL, but the gdpr.deletion event is still in
// the log for compliance bookkeeping). Audit failure does not block deletion.
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { error, json } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { clearSessionCookie } from '$lib/server/session';

const Body = z.object({
	confirm: z.string().min(1)
});

export const POST: RequestHandler = async (event) => {
	const { request, locals, cookies } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = Body.safeParse(await request.json().catch(() => ({})));
	if (!parsed.success) throw error(422, 'confirmation required');
	if (parsed.data.confirm !== locals.user.username) {
		throw error(422, 'confirmation string did not match your username');
	}

	const userId = locals.user.id;
	const username = locals.user.username;

	// Audit FIRST so the event survives the cascade. actorUserId will be
	// nulled by ON DELETE SET NULL once the user row is gone, but the row
	// itself stays for the retention window.
	await audit(event, {
		event: 'gdpr.deletion',
		actorUserId: userId,
		subjectUserId: userId,
		metadata: { username }
	});

	await db.delete(schema.users).where(eq(schema.users.id, userId));

	clearSessionCookie(cookies);
	// `locals.user` lives only for this request; subsequent requests will
	// look up the session, find it gone, and treat the client as anonymous.
	return json({
		ok: true,
		message:
			'Your account and all associated personal data have been deleted. Anonymous posts and ' +
			'comments authored under your former identities remain because they are not linked to ' +
			'any user in our database.'
	});
};
