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

async function jsonPost(path: string, body: unknown, origin?: string): Promise<Response> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (origin) headers.origin = origin;
	return api(path, { method: 'POST', headers, body: JSON.stringify(body) });
}

// The CSRF guard runs before any handler (and before auth), so any JSON POST
// under /api/ exercises it. We use surviving authed endpoints; a cross-origin
// request is rejected at 403 before the 401 auth check ever runs.
describe('CSRF: same-origin guard for JSON API mutations', () => {
	it('POST /api/identity with mismatched Origin → 403', async () => {
		const res = await jsonPost('/api/identity', { idc: '1' }, EVIL_ORIGIN);
		expect(res.status).toBe(403);
	});

	it('POST /api/user with mismatched Origin → 403', async () => {
		const res = await jsonPost('/api/user', { username: 'someone' }, EVIL_ORIGIN);
		expect(res.status).toBe(403);
	});

	it('POST /api/identity/rotate with mismatched Origin → 403', async () => {
		const res = await jsonPost('/api/identity/rotate', { idc: '1' }, EVIL_ORIGIN);
		expect(res.status).toBe(403);
	});

	it('same-origin POST proceeds (may 401 downstream, but NOT 403 from CSRF)', async () => {
		const res = await jsonPost('/api/identity', { idc: '1' }, BASE_URL);
		// Unauthed → 401, but it MUST NOT be a 403 from the CSRF guard.
		expect(res.status).not.toBe(403);
	});

	it('no Origin and no Sec-Fetch-Site is allowed (e.g. direct curl / server-to-server)', async () => {
		const res = await jsonPost('/api/identity', { idc: '1' });
		expect(res.status).not.toBe(403);
	});

	it('Phase 4: Origin absent but Sec-Fetch-Site: cross-site → 403 (closed gap)', async () => {
		const res = await api('/api/identity', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' },
			body: JSON.stringify({ idc: '1' })
		});
		expect(res.status).toBe(403);
	});

	it('Phase 4: Origin absent but Sec-Fetch-Site: same-origin is allowed', async () => {
		const res = await api('/api/identity', {
			method: 'POST',
			headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
			body: JSON.stringify({ idc: '1' })
		});
		// Not 403 from the guard (downstream 401 is fine).
		expect(res.status).not.toBe(403);
	});

	it('text/plain POST with mismatched Origin → 403 (SvelteKit default CSRF; verified for defense-in-depth)', async () => {
		// SvelteKit's built-in CSRF rejects non-form / non-JSON unsafe POSTs
		// from a cross-origin caller. Our hook only covers JSON, but the
		// platform default catches this case before our hook ever runs. We
		// assert it just to document the layered behavior.
		const res = await api('/api/identity', {
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
