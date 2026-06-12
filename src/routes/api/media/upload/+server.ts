// Image upload endpoint. Filesystem-backed: hash bytes with sha256 and store
// as `static/uploads/<user-id-first-2>/<hash>.<ext>`. Returns `/uploads/<...>`
// for the client to embed. Dedupe is automatic — identical bytes from the
// same user re-use the same hash file. A row in `media_uploads` tracks
// ownership + EXIF-stripped status so we can list-by-uploader, audit, and
// reap orphans.
//
// EXIF stripping: we re-encode every upload via `sharp` and drop metadata.
// `withMetadata({ exif: {} })` would preserve EXIF; we explicitly do not.
// GIFs are passed through unchanged because sharp's animated-GIF re-encode
// drops frames in some cases.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { enforce, type RateLimitRule } from '$lib/server/rate-limit';
import { db, schema } from '$lib/db/client';
import { and, eq } from 'drizzle-orm';
import { audit } from '$lib/server/audit';

const ALLOWED: Record<string, { ext: string; reencode: boolean }> = {
	'image/jpeg': { ext: 'jpg', reencode: true },
	'image/png': { ext: 'png', reencode: true },
	'image/webp': { ext: 'webp', reencode: true },
	'image/gif': { ext: 'gif', reencode: false }
};

const MAX_BYTES = 5 * 1024 * 1024; // 5 MiB
export const config = { bodySizeLimit: 8 * 1024 * 1024 };

const UPLOAD_RULE: RateLimitRule = {
	bucket: 'media:upload',
	max: 20,
	windowSeconds: 60 * 60
};

const UPLOAD_ROOT = 'static/uploads';

async function stripExif(
	bytes: Uint8Array,
	mime: string
): Promise<{ output: Uint8Array; width?: number; height?: number }> {
	const cfg = ALLOWED[mime];
	if (!cfg.reencode) return { output: bytes };
	const img = sharp(Buffer.from(bytes), { failOn: 'truncated' });
	const meta = await img.metadata();
	// rotate() honors the EXIF orientation tag *before* we drop EXIF, so the
	// rendered orientation survives even though the metadata doesn't.
	let pipeline = img.rotate();
	if (mime === 'image/jpeg') pipeline = pipeline.jpeg({ quality: 85, mozjpeg: true });
	else if (mime === 'image/png') pipeline = pipeline.png({ compressionLevel: 9 });
	else if (mime === 'image/webp') pipeline = pipeline.webp({ quality: 85 });
	const output = await pipeline.toBuffer();
	return {
		output: new Uint8Array(output),
		width: meta.width,
		height: meta.height
	};
}

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	await enforce(UPLOAD_RULE, event, { keyBy: 'user' });

	const contentType = request.headers.get('content-type') ?? '';
	if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
		throw error(415, 'expected multipart/form-data');
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch (err) {
		const msg = (err as Error)?.message ?? '';
		if (/too large|exceed|413/i.test(msg)) {
			throw error(413, `file exceeds ${MAX_BYTES} byte limit`);
		}
		throw error(400, `unreadable multipart body: ${msg}`);
	}
	const file = form.get('file');
	if (!(file instanceof File)) throw error(422, 'missing "file" field');
	if (file.size > MAX_BYTES) throw error(413, `file exceeds ${MAX_BYTES} byte limit`);
	if (file.size === 0) throw error(422, 'empty file');

	const mime = file.type.toLowerCase();
	const cfg = ALLOWED[mime];
	if (!cfg) throw error(415, `unsupported mime type: ${mime || 'unknown'}`);

	const incomingBytes = new Uint8Array(await file.arrayBuffer());
	if (incomingBytes.byteLength > MAX_BYTES) {
		throw error(413, `file exceeds ${MAX_BYTES} byte limit`);
	}

	// Re-encode through sharp to strip EXIF (size may shrink, dimensions
	// recorded for the media_uploads row).
	let stripped: { output: Uint8Array; width?: number; height?: number };
	try {
		stripped = await stripExif(incomingBytes, mime);
	} catch (err) {
		// Malformed image, sharp refused. Treat as 422 so the client can
		// retry with a different file.
		throw error(422, `image processing failed: ${(err as Error).message}`);
	}

	const finalBytes = stripped.output;
	const hash = createHash('sha256').update(finalBytes).digest('hex');
	const userPrefix = locals.user.id.slice(0, 2);
	const dir = join(UPLOAD_ROOT, userPrefix);
	const filename = `${hash}.${cfg.ext}`;
	const fullPath = join(dir, filename);

	await mkdir(dir, { recursive: true });
	await writeFile(fullPath, finalBytes);

	// Upsert the metadata row. Dedupe per (user, sha256) — same content from
	// the same user maps to one row.
	const existing = await db
		.select({ id: schema.mediaUploads.id })
		.from(schema.mediaUploads)
		.where(
			and(
				eq(schema.mediaUploads.uploaderUserId, locals.user.id),
				eq(schema.mediaUploads.sha256, hash)
			)
		)
		.limit(1);
	let mediaId: string;
	if (existing[0]) {
		mediaId = existing[0].id;
	} else {
		const [row] = await db
			.insert(schema.mediaUploads)
			.values({
				uploaderUserId: locals.user.id,
				sha256: hash,
				mimeType: mime,
				byteSize: finalBytes.byteLength,
				width: stripped.width,
				height: stripped.height,
				exifStripped: cfg.reencode ? new Date() : null
			})
			.returning({ id: schema.mediaUploads.id });
		mediaId = row.id;
		await audit(event, {
			event: 'media.uploaded',
			actorUserId: locals.user.id,
			metadata: { mime, bytes: finalBytes.byteLength, sha256: hash }
		});
	}

	return json({
		id: mediaId,
		url: `/uploads/${userPrefix}/${filename}`,
		hash,
		bytes: finalBytes.byteLength,
		mime,
		width: stripped.width ?? null,
		height: stripped.height ?? null
	});
};
