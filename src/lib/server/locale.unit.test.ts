// Unit tests for negotiateLocale().
//
// We need to stub `$app/environment` for the i18n module that locale.ts
// transitively imports — otherwise vitest's SSR loader tries to resolve the
// SvelteKit alias and fails outside the Kit runtime.
import { describe, it, expect, vi } from 'vitest';

vi.mock('$app/environment', () => ({ browser: false, dev: true }));

import { negotiateLocale } from './locale';

function makeRequest(headers: Record<string, string> = {}): Request {
	return new Request('http://localhost/', { headers });
}

describe('negotiateLocale: cookie wins', () => {
	it('returns the cookie locale when it is supported', () => {
		const req = makeRequest({ 'accept-language': 'fr-FR,fr;q=0.9' });
		expect(negotiateLocale(req, 'en')).toBe('en');
	});

	it('ignores the cookie when it is not a supported locale', () => {
		const req = makeRequest({ 'accept-language': 'en-US,en;q=0.9' });
		// 'zz' is junk — falls through to Accept-Language.
		expect(negotiateLocale(req, 'zz')).toBe('en');
	});

	it('ignores an empty/undefined cookie', () => {
		const req = makeRequest({ 'accept-language': 'en' });
		expect(negotiateLocale(req, undefined)).toBe('en');
		expect(negotiateLocale(req, '')).toBe('en');
	});
});

describe('negotiateLocale: Accept-Language parsing', () => {
	it('returns en for a simple en header', () => {
		const req = makeRequest({ 'accept-language': 'en' });
		expect(negotiateLocale(req, undefined)).toBe('en');
	});

	it('matches en for en-US via language subtag', () => {
		const req = makeRequest({ 'accept-language': 'en-US,en;q=0.9' });
		expect(negotiateLocale(req, undefined)).toBe('en');
	});

	it('honours quality weighting (highest q wins among supported)', () => {
		// fr is unsupported; en is supported and present with lower q. Should
		// still pick en, since fr is unmatchable.
		const req = makeRequest({ 'accept-language': 'fr-FR;q=0.9,en;q=0.3' });
		expect(negotiateLocale(req, undefined)).toBe('en');
	});

	it('skips q=0 entries', () => {
		// en explicitly disabled, ja unsupported -> fall through to default.
		const req = makeRequest({ 'accept-language': 'en;q=0,ja' });
		expect(negotiateLocale(req, undefined)).toBe('en');
	});
});

describe('negotiateLocale: fallback', () => {
	it("returns 'en' when no header and no cookie are present", () => {
		const req = makeRequest();
		expect(negotiateLocale(req, undefined)).toBe('en');
	});

	it("returns 'en' when nothing matches a supported locale", () => {
		const req = makeRequest({ 'accept-language': 'fr,de,ja,zh' });
		expect(negotiateLocale(req, undefined)).toBe('en');
	});
});
