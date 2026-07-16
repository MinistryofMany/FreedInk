// Unit tests for safeNext, the open-redirect / fragment-injection guard on the
// post-login `next` destination. Pure function — mock the module's env and SDK
// imports so importing it doesn't pull in the SDK or touch env.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('@minister/client', () => ({
	createMinisterClient: () => ({}),
	generatePkce: async () => ({ verifier: '', challenge: '' }),
	randomUrlToken: () => ''
}));

import { safeNext } from './oidc';

describe('safeNext', () => {
	it('passes a normal relative path unchanged', () => {
		expect(safeNext('/admin')).toBe('/admin');
		expect(safeNext('/blog/x?y=1')).toBe('/blog/x?y=1');
	});

	it('returns null for empty/nullish input', () => {
		expect(safeNext(null)).toBeNull();
		expect(safeNext(undefined)).toBeNull();
		expect(safeNext('')).toBeNull();
	});

	it('rejects protocol-relative and backslash open-redirect tricks', () => {
		expect(safeNext('//evil.example')).toBeNull();
		expect(safeNext('/\\evil.example')).toBeNull();
		expect(safeNext('https://evil.example')).toBeNull();
	});

	it('strips a URL fragment so it cannot override the anon-identity fragment', () => {
		expect(safeNext('/#x')).toBe('/');
		expect(safeNext('/path#frag')).toBe('/path');
		// A decoded `?next=/%23x` arrives here as the literal `/#x`.
		expect(safeNext(decodeURIComponent('/%23x'))).toBe('/');
		expect(safeNext('/admin?a=1#minister_anon=v1.deadbeef')).toBe('/admin?a=1');
	});
});
