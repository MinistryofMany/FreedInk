// Unit tests for the i18n bootstrap. We exercise:
//   - that init runs without throwing and sets the locale to a supported tag
//   - that the `_` translator looks up keys correctly
//   - that ICU-style {placeholder} interpolation works
//   - that an unknown key falls back to itself (svelte-i18n's default
//     behaviour) and emits a warning rather than crashing
//   - that pickSupported handles exact / language-subtag / mismatch cases
import { describe, it, expect, beforeAll } from 'vitest';
import { get } from 'svelte/store';

// svelte-i18n reads `browser` from `$app/environment` during module init —
// stub it to false so the test environment doesn't try to call
// `getLocaleFromNavigator()`, which depends on jsdom's `navigator.language`.
// (We force-init below regardless.)
import { vi } from 'vitest';
vi.mock('$app/environment', () => ({ browser: false, dev: true }));

import { _, locale, init, pickSupported, DEFAULT_LOCALE, SUPPORTED_LOCALES } from './index';
import { waitLocale } from 'svelte-i18n';

beforeAll(async () => {
	// Importing `./index` already calls init() once. Re-init explicitly here
	// so the test is hermetic in case of import ordering surprises.
	init({ fallbackLocale: DEFAULT_LOCALE, initialLocale: DEFAULT_LOCALE });
	await waitLocale(DEFAULT_LOCALE);
});

describe('i18n init + locale defaults', () => {
	it('sets the active locale to the default', () => {
		expect(get(locale)).toBe(DEFAULT_LOCALE);
	});

	it('includes en in the supported set', () => {
		expect(SUPPORTED_LOCALES).toContain('en');
	});
});

describe('message lookup', () => {
	it('returns the English string for a known key', () => {
		const t = get(_);
		expect(t('nav.brand')).toBe('Freed.Ink');
		expect(t('home.cta')).toBe('Free Your Ink');
		expect(t('comments.empty')).toBe('No comments yet.');
	});

	it('interpolates ICU-style {placeholder} values', () => {
		const t = get(_);
		expect(t('post.published_at', { values: { date: '2026-05-18' } })).toBe('Published 2026-05-18');
		expect(t('post.status', { values: { status: 'draft' } })).toBe('Status: draft');
		expect(t('admin.welcome', { values: { name: 'Tyler' } })).toBe('Welcome Tyler');
	});

	it('returns the key itself when no message exists (graceful fallback)', () => {
		const t = get(_);
		// svelte-i18n logs a warning and returns the key when nothing matches.
		// Either behaviour is acceptable for our purposes; we just want to
		// confirm it does NOT throw.
		expect(() => t('definitely.not.a.real.key')).not.toThrow();
		expect(t('definitely.not.a.real.key')).toBe('definitely.not.a.real.key');
	});
});

describe('pickSupported', () => {
	it('returns null for null / undefined / empty', () => {
		expect(pickSupported(null)).toBeNull();
		expect(pickSupported(undefined)).toBeNull();
		expect(pickSupported('')).toBeNull();
	});

	it('returns the exact match', () => {
		expect(pickSupported('en')).toBe('en');
	});

	it('matches on the language subtag', () => {
		expect(pickSupported('en-US')).toBe('en');
		expect(pickSupported('en_GB')).toBe('en');
		expect(pickSupported('EN-us')).toBe('en');
	});

	it('returns null for unsupported tags', () => {
		expect(pickSupported('fr')).toBeNull();
		expect(pickSupported('ja-JP')).toBeNull();
	});
});
