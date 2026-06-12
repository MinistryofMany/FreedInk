// Soft-delete a user's uploaded image by content hash. Marks the media_uploads
// row deleted_at = now() and unlinks the file. Ownership is enforced via the
// media_uploads.uploader_user_id check; we also only look inside the caller's
// own user-id-prefixed folder as defense-in-depth.
//
// Idempotent: if the file or row is gone, we still 200. Best-effort on the fs
// side — a row marked deleted whose file was already missing is acceptable.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull } from 'drizzle-orm';
import { audit } from '$lib/server/audit';

const UPLOAD_ROOT = 'static/uploads';

function isHexHash(s: string): boolean {
	return /^[a-f0-9]{64}$/.test(s);
}

export const DELETE: RequestHandler = async (event) => {
	const { params, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const hash = params.hash ?? '';
	if (!isHexHash(hash)) throw error(422, 'invalid hash');

	const userPrefix = locals.user.id.slice(0, 2);
	const dir = join(UPLOAD_ROOT, userPrefix);

	// Mark the metadata row deleted (idempotent — already-deleted rows are
	// just touched).
	const rows = await db
		.update(schema.mediaUploads)
		.set({ deletedAt: new Date() })
		.where(
			and(
				eq(schema.mediaUploads.uploaderUserId, locals.user.id),
				eq(schema.mediaUploads.sha256, hash),
				isNull(schema.mediaUploads.deletedAt)
			)
		)
		.returning({ id: schema.mediaUploads.id });

	if (rows[0]) {
		await audit(event, {
			event: 'media.deleted',
			actorUserId: locals.user.id,
			metadata: { sha256: hash }
		});
	}

	// Unlink the file too. Find by hash-prefix because extension varies.
	let entries: string[];
	try {
		entries = await readdir(dir);
	} catch {
		return json({ ok: true, deleted: false });
	}
	const match = entries.find((name) => name.startsWith(`${hash}.`));
	if (!match) return json({ ok: true, deleted: false });
	try {
		await unlink(join(dir, match));
	} catch {
		return json({ ok: true, deleted: true });
	}
	return json({ ok: true, deleted: true });
};
