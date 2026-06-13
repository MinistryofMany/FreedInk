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
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { db, schema } from '$lib/db/client';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { audit } from '$lib/server/audit';
import { clearSessionCookie } from '$lib/server/session';
import { log } from '$lib/server/log';

const Body = z.object({
	confirm: z.string().min(1)
});

// On-disk layout mirrors src/routes/api/media/upload/+server.ts:
// `static/uploads/<uploaderUserId-first-2>/<sha256>.<ext>`. The extension is
// derived from the stored mime_type. Keep this map in sync with the upload
// endpoint's ALLOWED table.
const UPLOAD_ROOT = 'static/uploads';
const EXT_BY_MIME: Record<string, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'image/gif': 'gif'
};

// Erase the on-disk image bytes for the leaving user. Rows cascade-delete with
// the user, but the files do not, so personal image bytes would survive the
// erasure. Files are deduped by sha256, so a hash still referenced by another
// user's media_uploads row must be left in place. Best-effort: a missing file
// (ENOENT) or any unlink error never blocks the account deletion.
async function eraseUserMedia(userId: string): Promise<void> {
	const rows = await db
		.select({
			sha256: schema.mediaUploads.sha256,
			mimeType: schema.mediaUploads.mimeType
		})
		.from(schema.mediaUploads)
		.where(eq(schema.mediaUploads.uploaderUserId, userId));
	if (rows.length === 0) return;

	// Which of this user's hashes are still referenced by some *other* user.
	// Those files stay on disk (shared content); we only unlink the rest.
	const hashes = [...new Set(rows.map((r) => r.sha256))];
	const shared = await db
		.select({ sha256: schema.mediaUploads.sha256 })
		.from(schema.mediaUploads)
		.where(
			and(
				inArray(schema.mediaUploads.sha256, hashes),
				ne(schema.mediaUploads.uploaderUserId, userId)
			)
		);
	const sharedHashes = new Set(shared.map((r) => r.sha256));

	const userPrefix = userId.slice(0, 2);
	for (const row of rows) {
		if (sharedHashes.has(row.sha256)) continue;
		const ext = EXT_BY_MIME[row.mimeType];
		if (!ext) {
			// Unknown mime means we can't reconstruct the on-disk name. Log and
			// move on rather than guess at a path.
			log.warn({ userId, sha256: row.sha256, mime: row.mimeType }, 'gdpr media: unknown mime');
			continue;
		}
		const fullPath = join(UPLOAD_ROOT, userPrefix, `${row.sha256}.${ext}`);
		try {
			await unlink(fullPath);
		} catch (err) {
			const code = (err as NodeJS.ErrnoException)?.code;
			if (code === 'ENOENT') continue; // already gone - fine
			log.error({ err, userId, path: fullPath }, 'gdpr media: unlink failed');
		}
	}
}

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

	// Erase on-disk image bytes BEFORE the cascade removes media_uploads rows;
	// once the rows are gone we can't reconstruct which files were this user's.
	await eraseUserMedia(userId);

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
