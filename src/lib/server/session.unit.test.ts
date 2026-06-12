// Pure unit tests for the session cookie HMAC / pack / unpack. The DB-touching
// parts of session.ts are exercised by the integration tests.
//
// We don't want to import the real `$lib/db/client` (which would try to open a
// pool just to test pure crypto), so the file uses Vitest's module mock to
// stub it out before importing the SUT.
import { describe, it, expect, vi, beforeAll } from 'vitest';

vi.mock('$lib/db/client', () => ({
	db: {} as unknown,
	schema: {} as unknown
}));
vi.mock('$app/environment', () => ({ dev: true, browser: false }));

// Ensure the secret is set before module evaluation reads it.
beforeAll(() => {
	if (!process.env.SESSION_SECRET) {
		process.env.SESSION_SECRET = 'a'.repeat(64);
	}
});

import { sign, packCookie, unpackCookie, randomToken } from './session';

describe('cookie HMAC', () => {
	it('signs deterministically for the same input', () => {
		const a = sign('abc');
		const b = sign('abc');
		expect(a).toBe(b);
	});

	it('produces different signatures for different inputs', () => {
		expect(sign('abc')).not.toBe(sign('abd'));
	});

	it('produces base64url-safe output', () => {
		expect(sign('test')).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('packs <sessionId>.<sig> and unpacks back to sessionId', () => {
		const id = 'd5b6f6e4-8aa1-4b13-9c01-2f3e4a5b6c7d';
		const cookie = packCookie(id);
		expect(cookie.startsWith(id + '.')).toBe(true);
		expect(unpackCookie(cookie)).toBe(id);
	});

	it('rejects a cookie without a separator', () => {
		expect(unpackCookie('justarawvalue')).toBeNull();
	});

	it('rejects a cookie with a tampered session id', () => {
		const id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
		const cookie = packCookie(id);
		const swapped = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaab' + cookie.slice(36);
		expect(unpackCookie(swapped)).toBeNull();
	});

	it('rejects a cookie with a tampered signature', () => {
		const id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
		const cookie = packCookie(id);
		const flipped = cookie.slice(0, -1) + (cookie.endsWith('a') ? 'b' : 'a');
		expect(unpackCookie(flipped)).toBeNull();
	});

	it('rejects a cookie with the wrong signature length', () => {
		const id = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
		expect(unpackCookie(id + '.short')).toBeNull();
		expect(unpackCookie(id + '.' + 'x'.repeat(200))).toBeNull();
	});
});

describe('randomToken', () => {
	it('produces tokens of the requested byte length (base64url-encoded)', () => {
		const t = randomToken(32);
		// 32 bytes → 43 base64url chars (no padding)
		expect(t.length).toBe(43);
		expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it('returns different tokens each call', () => {
		const a = randomToken();
		const b = randomToken();
		expect(a).not.toBe(b);
	});
});
