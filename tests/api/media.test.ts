// API tests for /api/media/upload and DELETE /api/media/[hash].
//
// The endpoint accepts multipart/form-data; we hand-build a minimal Request
// object via Web `FormData` + `File`. Node 20+ has both built-in, so no
// FormData polyfill is needed.
import { describe, it, expect, beforeEach } from 'vitest';
import { api, asUser, BASE_URL } from './helpers';
import { makeUser } from '../setup/factories';
import { db, schema } from '$lib/db/client';
import { sql } from 'drizzle-orm';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

async function uploadFile(opts: {
	cookie?: string;
	bytes: Uint8Array;
	type: string;
	name?: string;
}): Promise<Response> {
	const form = new FormData();
	// Copy into a plain ArrayBuffer to dodge the SharedArrayBuffer-tinged
	// Uint8Array typing that lib.dom doesn't accept as a BlobPart.
	const buf = new ArrayBuffer(opts.bytes.byteLength);
	new Uint8Array(buf).set(opts.bytes);
	const blob = new Blob([buf], { type: opts.type });
	form.append('file', blob, opts.name ?? 'test.bin');
	// SvelteKit's built-in CSRF blocks form-like POSTs whose Origin doesn't
	// match the request URL. Node 20+ fetch sets Origin automatically; we
	// stamp the same-origin value so the request reaches our handler.
	const headers: Record<string, string> = { origin: BASE_URL };
	if (opts.cookie) headers.cookie = opts.cookie;
	return fetch(BASE_URL + '/api/media/upload', {
		method: 'POST',
		headers,
		body: form
	});
}

// Minimal valid 1x1 white JPEG (134 bytes). Used to be a fake 8-byte header,
// but the upload endpoint now runs the bytes through sharp to strip EXIF, which
// requires a parseable image.
const FAKE_JPEG = new Uint8Array(
	Buffer.from(
		'/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAA//2Q==',
		'base64'
	)
);

async function truncateRateLimits(): Promise<void> {
	await db.execute(sql`TRUNCATE TABLE ${schema.rateLimits}`);
}

describe('POST /api/media/upload', () => {
	beforeEach(async () => {
		await truncateRateLimits();
	});

	it('rejects unauthenticated callers with 401', async () => {
		const res = await uploadFile({ bytes: FAKE_JPEG, type: 'image/jpeg' });
		await res.text();
		expect(res.status).toBe(401);
	});

	it('accepts a small jpeg and returns a /uploads URL', async () => {
		const u = await makeUser({ username: 'uploader' });
		const { cookie } = await asUser(u);
		const res = await uploadFile({ cookie, bytes: FAKE_JPEG, type: 'image/jpeg' });
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.url).toMatch(/^\/uploads\/[a-f0-9]{2}\/[a-f0-9]{64}\.jpg$/);
		expect(json.hash).toMatch(/^[a-f0-9]{64}$/);
		// Bytes after sharp re-encodes — value depends on libjpeg/mozjpeg output
		// for a 1x1 image, just confirm it's a small positive number.
		expect(json.bytes).toBeGreaterThan(0);
		expect(json.bytes).toBeLessThan(2000);

		// File should actually exist on disk (test server uses cwd = repo root).
		const onDisk = join(process.cwd(), 'static', json.url.replace('/uploads/', 'uploads/'));
		expect(existsSync(onDisk)).toBe(true);

		// Cleanup so reruns don't accumulate fixtures.
		rmSync(onDisk, { force: true });
	});

	it('rejects an oversized file with 413', async () => {
		const u = await makeUser({ username: 'big' });
		const { cookie } = await asUser(u);
		const huge = new Uint8Array(6 * 1024 * 1024); // 6 MiB > 5 MiB cap
		const res = await uploadFile({ cookie, bytes: huge, type: 'image/jpeg' });
		await res.text();
		expect(res.status).toBe(413);
	});

	it('rejects a disallowed mime type with 415', async () => {
		const u = await makeUser({ username: 'wrong-mime' });
		const { cookie } = await asUser(u);
		const res = await uploadFile({
			cookie,
			bytes: new Uint8Array([1, 2, 3]),
			type: 'application/pdf'
		});
		await res.text();
		expect(res.status).toBe(415);
	});

	it('DELETE /api/media/[hash] removes the file (auth required)', async () => {
		const u = await makeUser({ username: 'deleter' });
		const { cookie } = await asUser(u);
		const up = await uploadFile({ cookie, bytes: FAKE_JPEG, type: 'image/jpeg' });
		expect(up.status).toBe(200);
		const { hash, url } = await up.json();

		// Unauth DELETE → 401.
		const unauth = await fetch(BASE_URL + `/api/media/${hash}`, { method: 'DELETE' });
		await unauth.text();
		expect(unauth.status).toBe(401);

		const del = await fetch(BASE_URL + `/api/media/${hash}`, {
			method: 'DELETE',
			headers: { cookie }
		});
		expect(del.status).toBe(200);
		const delJson = await del.json();
		expect(delJson.deleted).toBe(true);

		const onDisk = join(process.cwd(), 'static', url.replace('/uploads/', 'uploads/'));
		expect(existsSync(onDisk)).toBe(false);

		// Second delete is idempotent (deleted=false but still 200).
		const again = await fetch(BASE_URL + `/api/media/${hash}`, {
			method: 'DELETE',
			headers: { cookie }
		});
		const againJson = await again.json();
		expect(again.status).toBe(200);
		expect(againJson.deleted).toBe(false);
	});
});
