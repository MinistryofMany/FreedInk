// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

// minister-anon reads `browser` from `$app/environment`; under jsdom the real
// flag is false, so mock it the same way vault.unit.test.ts does.
vi.mock('$app/environment', () => ({ browser: true, dev: true }));

// The module holds per-document-load state (captured secret, memoized seed),
// so every test re-imports a fresh copy via resetModules.
type MinisterAnon = typeof import('./minister-anon');
async function freshModule(): Promise<MinisterAnon> {
	vi.resetModules();
	return import('./minister-anon');
}

// Spec §9.2 golden vector: per_app_secret = the §8.1 `deforum` vector,
// rp_mix_secret = utf8("example-rp-mix-secret-32-bytes!!").
const APP_SECRET_B64URL = 'pqORh0VKzCh-Yrnq6r7O-MZ78IUA_FO9XgCRKrD3Gl4';
const MIX_B64URL = 'ZXhhbXBsZS1ycC1taXgtc2VjcmV0LTMyLWJ5dGVzISE';
const EXPECTED_SEED_HEX = '09aa876834bad70b4c38e57dbecea98c69f127e240e4eb021ed6d822cab554d5';

const VALID_FRAGMENT = `#minister_anon=v1.${APP_SECRET_B64URL}`;

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function setUrl(pathAndHash: string) {
	history.replaceState(null, '', pathAndHash);
}

beforeAll(async () => {
	if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
		const { webcrypto } = await import('node:crypto');
		// @ts-expect-error - patching for test env
		globalThis.crypto = webcrypto;
	}
});

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	setUrl('/signup/identity');
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	warnSpy.mockRestore();
	setUrl('/');
});

describe('minister anon handoff', () => {
	it('yields no seed when no fragment arrived (byte-identical legacy path)', async () => {
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		expect(location.hash).toBe('');
		await expect(mod.ministerIdentitySeed(MIX_B64URL)).resolves.toBeNull();
		expect(warnSpy).not.toHaveBeenCalled();
	});

	it('captures + scrubs the fragment and derives the spec §9.2 golden vector', async () => {
		setUrl(`/signup/identity${VALID_FRAGMENT}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		// Scrubbed before anything else can read it (finding S4).
		expect(location.hash).toBe('');
		expect(location.pathname).toBe('/signup/identity');
		const seed = await mod.ministerIdentitySeed(MIX_B64URL);
		expect(seed).not.toBeNull();
		expect(seed!.byteLength).toBe(32);
		expect(toHex(seed!)).toBe(EXPECTED_SEED_HEX);
	});

	it('preserves other fragment params when scrubbing', async () => {
		setUrl(`/signup/identity#foo=1&minister_anon=v1.${APP_SECRET_B64URL}&bar=2`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		expect(location.hash).toBe('#foo=1&bar=2');
		await expect(mod.ministerIdentitySeed(MIX_B64URL)).resolves.not.toBeNull();
	});

	it('memoizes the seed so a retried submit re-uses the same identity', async () => {
		setUrl(`/signup/identity${VALID_FRAGMENT}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		const first = await mod.ministerIdentitySeed(MIX_B64URL);
		const second = await mod.ministerIdentitySeed(MIX_B64URL);
		expect(first).not.toBeNull();
		expect(second).toBe(first);
	});

	it('fails closed when the mix secret is unset', async () => {
		setUrl(`/signup/identity${VALID_FRAGMENT}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		await expect(mod.ministerIdentitySeed(null)).resolves.toBeNull();
		await expect(mod.ministerIdentitySeed(undefined)).resolves.toBeNull();
		expect(warnSpy).toHaveBeenCalled();
		// The dropped secret cannot be resurrected by later providing a mix.
		await expect(mod.ministerIdentitySeed(MIX_B64URL)).resolves.toBeNull();
	});

	it('fails closed when the mix secret is shorter than 32 bytes', async () => {
		setUrl(`/signup/identity${VALID_FRAGMENT}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		// 16 bytes, base64url.
		await expect(mod.ministerIdentitySeed('AAAAAAAAAAAAAAAAAAAAAA')).resolves.toBeNull();
		expect(warnSpy).toHaveBeenCalled();
	});

	it('fails closed when the mix secret is not base64url', async () => {
		setUrl(`/signup/identity${VALID_FRAGMENT}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		await expect(mod.ministerIdentitySeed('not base64url!!! definitely $$$')).resolves.toBeNull();
		expect(warnSpy).toHaveBeenCalled();
	});

	it('scrubs but rejects a malformed or unknown-version fragment', async () => {
		setUrl('/signup/identity#minister_anon=v9.AAAA');
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		expect(location.hash).toBe('');
		await expect(mod.ministerIdentitySeed(MIX_B64URL)).resolves.toBeNull();
	});
});
