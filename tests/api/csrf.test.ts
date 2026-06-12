// Same-origin CSRF guard in hooks.server.ts:
//   * Unsafe method (POST/PUT/PATCH/DELETE)
//   * Path under /api/
//   * Content-type JSON
//   * Origin header present and != event.url.origin
// → 403 before any handler logic runs.
//
// Requests without an Origin header (e.g. direct curl) bypass the check —
// browsers always set Origin on cross-origin POST/JSON, so this only buys
// us defense against same-document XHR/fetch from a malicious origin.
import { describe, it, expect } from 'vitest';
import { api, BASE_URL } from './helpers';

const EVIL_ORIGIN = 'https://evil.example.com';

async function jsonPost(
	path: string,
	body: unknown,
	origin?: string
): Promise<Response> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (origin) headers.origin = origin;
	return api(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

describe('CSRF: same-origin guard for JSON API mutations', () => {
	it('POST /api/auth/login/start with mismatched Origin → 403', async () => {
		const res = await jsonPost('/api/auth/login/start', {}, EVIL_ORIGIN);
		expect(res.status).toBe(403);
	});

	it('POST /api/auth/register/start with mismatched Origin → 403', async () => {
		const res = await jsonPost(
			'/api/auth/register/start',
			{ email: 'a@b.com', username: 'someone' },
			EVIL_ORIGIN
		);
		expect(res.status).toBe(403);
	});

	it('POST /api/verify with mismatched Origin → 403', async () => {
		const res = await jsonPost('/api/verify', { message: 'x', signature: 'x' }, EVIL_ORIGIN);
		expect(res.status).toBe(403);
	});

	it('same-origin POST proceeds (may fail downstream, but NOT 403 from CSRF)', async () => {
		const res = await jsonPost('/api/auth/login/start', {}, BASE_URL);
		// Login/start with no email → validator returns 200 with empty options
		// for our discovery-style flow; either way it MUST NOT be 403.
		expect(res.status).not.toBe(403);
	});

	it('no Origin header is allowed (e.g. direct curl) — only browsers send it', async () => {
		const res = await jsonPost('/api/auth/login/start', {});
		expect(res.status).not.toBe(403);
	});

	it('text/plain POST with mismatched Origin → 403 (SvelteKit default CSRF; verified for defense-in-depth)', async () => {
		// SvelteKit's built-in CSRF rejects non-form / non-JSON unsafe POSTs
		// from a cross-origin caller. Our hook only covers JSON, but the
		// platform default catches this case before our hook ever runs. We
		// assert it just to document the layered behavior.
		const res = await api('/api/auth/login/start', {
			method: 'POST',
			headers: {
				'content-type': 'text/plain',
				origin: EVIL_ORIGIN
			},
			body: '{}'
		});
		expect(res.status).toBe(403);
	});
});
