import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { db, schema } from '$lib/db/client';
import { and, eq, desc } from 'drizzle-orm';
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
	}),
	// Optional human label for this device ("laptop", "phone"). Phase 3.
	device_label: z.string().max(64).optional()
});

function b64urlToBytes(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	const b = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
	return new Uint8Array(b);
}

function blobToWire(id: {
	idc: string;
	publicKey: string;
	ciphertext: Uint8Array;
	kdfSalt: Uint8Array;
	nonce: Uint8Array;
	kdfParams: unknown;
	id?: string;
	deviceLabel?: string | null;
}) {
	return {
		id: id.id,
		device_label: id.deviceLabel ?? null,
		idc: id.idc,
		public_key: id.publicKey,
		ciphertext: Buffer.from(id.ciphertext).toString('base64url'),
		salt: Buffer.from(id.kdfSalt).toString('base64url'),
		nonce: Buffer.from(id.nonce).toString('base64url'),
		kdf: 'pbkdf2-sha256' as const,
		kdf_params: id.kdfParams
	};
}

// GET: return the user's active encrypted identity blobs (for unlock on login).
//
// Per-device model (Phase 3): a user may hold several active commitments, one
// per enrolled device. We return:
//   - `identity`:   the most-recently-created active blob (back-compat: single
//                   device clients unlock this directly).
//   - `identities`: ALL active blobs, newest first. A multi-device client can
//                   try each with the user's password and use the one that
//                   unlocks (each device has an independent password-derived
//                   key). The encrypted blobs never reveal the secret.
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
		.orderBy(desc(schema.userIdentities.createdAt));
	if (rows.length === 0) return json({ identity: null, identities: [] });
	const wire = rows.map(blobToWire);
	return json({ identity: wire[0], identities: wire });
};

// POST: enroll a device's identity. Per-device model (Phase 3): MULTIPLE active
// rows per user are allowed — one per device — so we no longer reject when an
// active row exists. The new commitment is added to every tree its user's
// capabilities place it in, so the device can prove immediately.
export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = BlobSchema.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	try {
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
			deviceLabel: parsed.data.device_label ?? null,
			status: 'active'
		});
	} catch (err) {
		// The idc is globally unique; re-enrolling the same commitment is a no-op
		// conflict the caller should treat as success-ish but we surface clearly.
		const { isUniqueViolation } = await import('$lib/server/db-errors');
		if (isUniqueViolation(err)) throw error(409, 'this identity commitment is already enrolled');
		throw err;
	}

	await refreshSnapshotsForUser(locals.user.id);
	await audit(event, {
		event: 'identity.created',
		actorUserId: locals.user.id,
		subjectUserId: locals.user.id,
		metadata: { idc: parsed.data.idc, device_label: parsed.data.device_label ?? null }
	});
	return json({ ok: true });
};
