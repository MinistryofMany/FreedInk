import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { refreshSnapshotsForUser } from '$lib/db/snapshots';
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
	const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
	return new Uint8Array(b);
}

// GET: return the user's active encrypted identity blob (for unlock on login).
export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const rows = await db
		.select()
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, locals.user.id),
				eq(schema.userIdentities.status, 'active')
			)
		)
		.limit(1);
	const id = rows[0];
	if (!id) return json({ identity: null });
	return json({
		identity: {
			idc: id.idc,
			public_key: id.publicKey,
			ciphertext: Buffer.from(id.ciphertext).toString('base64url'),
			salt: Buffer.from(id.kdfSalt).toString('base64url'),
			nonce: Buffer.from(id.nonce).toString('base64url'),
			kdf: 'pbkdf2-sha256',
			kdf_params: id.kdfParams
		}
	});
};

// POST: install the user's first identity (no existing active row).
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = BlobSchema.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	const existing = await db
		.select({ id: schema.userIdentities.id })
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, locals.user.id),
				eq(schema.userIdentities.status, 'active')
			)
		)
		.limit(1);
	if (existing.length > 0) throw error(409, 'identity already exists; use rotate');

	await db.insert(schema.userIdentities).values({
		userId: locals.user.id,
		idc: parsed.data.idc,
		publicKey: parsed.data.public_key,
		ciphertext: b64urlToBytes(parsed.data.ciphertext),
		// Write kdf explicitly rather than leaning on the column default - the
		// blob schema pins it to 'pbkdf2-sha256', so writing it guarantees the
		// stored row can never silently diverge from what the client used.
		kdf: parsed.data.kdf,
		kdfSalt: b64urlToBytes(parsed.data.salt),
		nonce: b64urlToBytes(parsed.data.nonce),
		kdfParams: parsed.data.kdf_params,
		status: 'active'
	});

	await refreshSnapshotsForUser(locals.user.id);
	await audit(event, {
		event: 'identity.created',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { idc: parsed.data.idc }
	});
	return json({ ok: true });
};
