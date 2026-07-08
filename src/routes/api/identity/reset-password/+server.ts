import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { enforce, RULES } from '$lib/server/rate-limit';
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

// Persistent forgotten-password reset. RE-ENCRYPTS an existing vault blob under a
// NEW password WITHOUT changing the Semaphore identity/commitment. The client
// proves control of the identity (recovery phrase OR old password), re-wraps the
// SAME secret, and posts the fresh blob here; we update the existing row in
// place. Because the idc is unchanged, this never collides with the global-unique
// idc index (which is exactly what blocks re-enrolling the same commitment as a
// new row), and every blog membership, past proof, and Merkle leaf stays valid.
//
// This is the ADDITIVE recoverable path; it does NOT touch the rotate
// "reset all devices" panic flow for the genuinely-lost case.
export const POST: RequestHandler = async (event) => {
	await enforce(RULES.identityRotate, event, { keyBy: 'user' });
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = BlobSchema.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	// Commitment-equality / authz. The caller may ONLY re-encrypt a commitment
	// that is already enrolled and active on their OWN account. Requiring the idc
	// to match a row we already hold both proves ownership and prevents swapping a
	// DIFFERENT identity in under the guise of a password reset. We cannot decrypt
	// the blob (the password never leaves the browser), so the equality we enforce
	// server-side is idc + public_key against the row on file; the client performs
	// the decrypt-to-same-commitment self-check before sending. Fail closed on any
	// mismatch.
	const rows = await db
		.select({
			id: schema.userIdentities.id,
			publicKey: schema.userIdentities.publicKey,
			status: schema.userIdentities.status
		})
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, locals.user.id),
				eq(schema.userIdentities.idc, parsed.data.idc)
			)
		)
		.limit(1);
	const target = rows[0];
	if (!target) throw error(404, 'no such identity on this account');
	if (target.status !== 'active') throw error(409, 'identity is revoked');
	if (target.publicKey !== parsed.data.public_key) {
		throw error(409, 'public key does not match the enrolled identity');
	}

	// Update the vault blob in place: new ciphertext/salt/nonce/params, SAME
	// idc/publicKey/status. No snapshot refresh — the commitment is unchanged, so
	// no tree, root, or membership moves.
	await db
		.update(schema.userIdentities)
		.set({
			ciphertext: b64urlToBytes(parsed.data.ciphertext),
			kdf: parsed.data.kdf,
			kdfSalt: b64urlToBytes(parsed.data.salt),
			nonce: b64urlToBytes(parsed.data.nonce),
			kdfParams: parsed.data.kdf_params
		})
		.where(eq(schema.userIdentities.id, target.id));

	await audit(event, {
		event: 'identity.password_reset',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { idc: parsed.data.idc, identity_id: target.id }
	});

	return json({ ok: true });
};
