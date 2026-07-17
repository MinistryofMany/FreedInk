// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// minister-anon reads `browser` from `$app/environment`; under jsdom the real
// flag is false, so force it true.
vi.mock('$app/environment', () => ({ browser: true, dev: true }));

// The module holds per-document-load state (the captured branch), so every test
// re-imports a fresh copy via resetModules. localStorage is the durable store and
// is cleared between tests.
type MinisterAnon = typeof import('./minister-anon');
async function freshModule(): Promise<MinisterAnon> {
	vi.resetModules();
	return import('./minister-anon');
}

// Two distinct valid branches (43 base64url chars → 32 bytes). The first is the
// spec §8.1 `deforum` per-app-secret vector; the second is arbitrary-but-valid.
const BRANCH_A = 'pqORh0VKzCh-Yrnq6r7O-MZ78IUA_FO9XgCRKrD3Gl4';
const BRANCH_B = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';

function fragOf(branch: string): string {
	return `#minister_anon=v1.${branch}`;
}

function b64urlToBytes(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
	const pad = '='.repeat((4 - (b64.length % 4)) % 4);
	const bin = atob(b64 + pad);
	return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function toHex(bytes: Uint8Array): string {
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function setUrl(pathAndHash: string) {
	history.replaceState(null, '', pathAndHash);
}

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
	localStorage.clear();
	setUrl('/');
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	warnSpy.mockRestore();
	setUrl('/');
});

describe('minister anon handoff (one-root)', () => {
	it('has no branch when no fragment arrived', async () => {
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		expect(location.hash).toBe('');
		mod.reconcileBranch(1);
		expect(mod.getStoredBranch()).toBeNull();
	});

	it('captures + scrubs the fragment and adopts the branch at the signed epoch', async () => {
		setUrl(`/${fragOf(BRANCH_A)}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		// Scrubbed before anything else can read it (finding S4).
		expect(location.hash).toBe('');
		// No branch is persisted until reconcile runs with the authoritative epoch.
		mod.reconcileBranch(1);
		const stored = mod.getStoredBranch();
		expect(stored).not.toBeNull();
		expect(toHex(stored!)).toBe(toHex(b64urlToBytes(BRANCH_A)));
	});

	it('preserves other fragment params when scrubbing', async () => {
		setUrl(`/#foo=1&minister_anon=v1.${BRANCH_A}&bar=2`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		expect(location.hash).toBe('#foo=1&bar=2');
		mod.reconcileBranch(1);
		expect(mod.getStoredBranch()).not.toBeNull();
	});

	it('re-keys to a new branch when the epoch strictly advances', async () => {
		// A previous login already keyed branch A at epoch 1.
		localStorage.setItem('freedink.minister.branch', BRANCH_A);
		localStorage.setItem('freedink.minister.epoch', '1');
		setUrl(`/${fragOf(BRANCH_B)}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		mod.reconcileBranch(2);
		expect(toHex(mod.getStoredBranch()!)).toBe(toHex(b64urlToBytes(BRANCH_B)));
		expect(localStorage.getItem('freedink.minister.epoch')).toBe('2');
	});

	it('does NOT clobber the current branch at an equal-or-lower epoch (anti-rollback)', async () => {
		localStorage.setItem('freedink.minister.branch', BRANCH_A);
		localStorage.setItem('freedink.minister.epoch', '2');
		// A stale login re-delivers an old branch at a non-advancing epoch.
		setUrl(`/${fragOf(BRANCH_B)}`);
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		mod.reconcileBranch(2);
		// Branch A is retained; branch B is ignored.
		expect(toHex(mod.getStoredBranch()!)).toBe(toHex(b64urlToBytes(BRANCH_A)));
	});

	it('keeps the stored branch when no fragment arrives on a later login', async () => {
		localStorage.setItem('freedink.minister.branch', BRANCH_A);
		localStorage.setItem('freedink.minister.epoch', '1');
		setUrl('/admin'); // no fragment
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		mod.reconcileBranch(1);
		expect(toHex(mod.getStoredBranch()!)).toBe(toHex(b64urlToBytes(BRANCH_A)));
	});

	it('scrubs but adopts nothing from a malformed / unknown-version fragment', async () => {
		setUrl('/#minister_anon=v9.AAAA');
		const mod = await freshModule();
		mod.captureMinisterAppSecret();
		expect(location.hash).toBe('');
		mod.reconcileBranch(1);
		expect(mod.getStoredBranch()).toBeNull();
	});
});
