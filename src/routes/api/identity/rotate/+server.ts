import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { refreshSnapshotsForUser } from '$lib/db/snapshots';
import { enforce, RULES } from '$lib/server/rate-limit';
import {
	createSession,
	destroySession,
	revokeAllSessions,
	SESSION_COOKIE_NAME,
	setSessionCookie
} from '$lib/server/session';
import { audit } from '$lib/server/audit';

const BlobSchema = z.object({
	idc: z.string().regex(/^\d+$/),
	public_key: z.string(),
	ciphertext: z.string(),
	salt: z.string(),
	nonce: z.string(),
	kdf: z.literal('pbkdf2-sha256'),
	kdf_params: z.object({
		name: z.literal('PBKDF2'),
		iterations: z.number().int().min(100_000),
		hash: z.literal('SHA-256')
	})
});

function b64urlToBytes(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64'));
}

export const POST: RequestHandler = async (event) => {
	await enforce(RULES.identityRotate, event, { keyBy: 'user' });
	const { request, locals, cookies, getClientAddress } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = BlobSchema.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	let revokedIdc: string | null = null;
	await db.transaction(async (tx) => {
		const revoked = await tx
			.update(schema.userIdentities)
			.set({ status: 'revoked', revokedAt: new Date() })
			.where(
				and(
					eq(schema.userIdentities.userId, locals.user!.id),
					eq(schema.userIdentities.status, 'active')
				)
			)
			.returning({ idc: schema.userIdentities.idc });
		revokedIdc = revoked[0]?.idc ?? null;
		await tx.insert(schema.userIdentities).values({
			userId: locals.user!.id,
			idc: parsed.data.idc,
			publicKey: parsed.data.public_key,
			ciphertext: b64urlToBytes(parsed.data.ciphertext),
			// Write kdf explicitly rather than leaning on the column default -
			// the blob schema pins it to 'pbkdf2-sha256', so writing it
			// guarantees the stored row can never silently diverge from what
			// the client used.
			kdf: parsed.data.kdf,
			kdfSalt: b64urlToBytes(parsed.data.salt),
			nonce: b64urlToBytes(parsed.data.nonce),
			kdfParams: parsed.data.kdf_params,
			status: 'active'
		});
	});

	await refreshSnapshotsForUser(locals.user.id);

	// Rotation reason might be loss-of-trust on another device — re-issue the
	// caller's session and revoke every other session for this user.
	const oldRaw = cookies.get(SESSION_COOKIE_NAME);
	await destroySession(oldRaw);
	const sessionId = await createSession(locals.user.id, {
		userAgent: request.headers.get('user-agent'),
		ip: getClientAddress()
	});
	setSessionCookie(cookies, sessionId);
	await revokeAllSessions(locals.user.id, sessionId);

	await audit(event, {
		event: 'identity.rotated',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { new_idc: parsed.data.idc, revoked_idc: revokedIdc }
	});
	return json({ ok: true });
};
