// @vitest-environment jsdom
import { describe, it, expect, beforeAll, vi } from 'vitest';

// The vault module assertions read `browser` from `$app/environment`. Under
// jsdom we have window/sessionStorage but SvelteKit's flag is still false, so
// mock the module to tell the vault we're "in the browser".
vi.mock('$app/environment', () => ({ browser: true, dev: true }));

import {
	generateIdentity,
	encryptIdentity,
	reEncryptIdentity,
	unlockIdentity,
	encodeForWire,
	decodeFromWire,
	cacheUnlockedIdentity,
	getCachedIdentity,
	clearCachedIdentity
} from './vault';
import { Identity } from '@semaphore-protocol/identity';
import { browser } from '$app/environment';

// jsdom doesn't ship a real WebCrypto by default in older Node; use node's
// subtle as a fallback so the AES-GCM round-trip works under jsdom.
beforeAll(async () => {
	if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
		const { webcrypto } = await import('node:crypto');
		// @ts-expect-error - patching for test env
		globalThis.crypto = webcrypto;
	}
});

describe('vault round-trip', () => {
	it('module reports running in browser context (jsdom)', () => {
		expect(browser).toBe(true);
	});

	it('generates an identity whose IDC matches the unlocked identity', async () => {
		const { identity, record } = await generateIdentity('correct horse battery staple');
		expect(record.idc).toBe(identity.commitment.toString());
		expect(record.publicKey).toBe(identity.publicKey.toString());
		expect(record.ciphertext.byteLength).toBeGreaterThan(0);
		expect(record.salt.byteLength).toBe(16);
		expect(record.nonce.byteLength).toBe(12);
		expect(record.kdf).toBe('pbkdf2-sha256');
		expect(record.kdfParams.iterations).toBeGreaterThanOrEqual(100_000);
	});

	it('unlocks with the correct password and recovers the same identity', async () => {
		const password = 'a very long secret password 12345';
		const { identity, record } = await generateIdentity(password);
		const recovered = await unlockIdentity(record, password);
		expect(recovered.commitment.toString()).toBe(identity.commitment.toString());
		expect(recovered.export()).toBe(identity.export());
	});

	it('rejects the wrong password with a clean error', async () => {
		const { record } = await generateIdentity('right password right password');
		await expect(unlockIdentity(record, 'wrong password wrong password')).rejects.toThrow(
			'wrong password'
		);
	});

	it('produces different ciphertexts for the same password (random salt/nonce)', async () => {
		const a = await generateIdentity('same password same password');
		const b = await generateIdentity('same password same password');
		// Different random salts/nonces → different ciphertexts even though plaintext differs too
		expect(a.record.salt).not.toEqual(b.record.salt);
		expect(a.record.nonce).not.toEqual(b.record.nonce);
	});

	it('encryptIdentity round-trips an externally-built Identity', async () => {
		const id = new Identity('seed-for-test');
		const record = await encryptIdentity(id, 'password password password');
		const back = await unlockIdentity(record, 'password password password');
		expect(back.commitment.toString()).toBe(id.commitment.toString());
	});
});

describe('re-encrypt (persistent password reset)', () => {
	it('keeps the same idc/commitment and decrypts under the NEW password', async () => {
		const oldPw = 'old password old password old';
		const { identity, record } = await generateIdentity(oldPw);
		const newPw = 'brand new password brand new';

		const rewrapped = await reEncryptIdentity(identity, newPw, record.idc);

		// Same identity binding, new ciphertext.
		expect(rewrapped.idc).toBe(record.idc);
		expect(rewrapped.publicKey).toBe(record.publicKey);
		expect(rewrapped.ciphertext).not.toEqual(record.ciphertext);

		// New password unlocks the SAME identity.
		const unlocked = await unlockIdentity(rewrapped, newPw);
		expect(unlocked.commitment.toString()).toBe(identity.commitment.toString());
		expect(unlocked.export()).toBe(identity.export());
	});

	it('the old password no longer opens the re-encrypted blob', async () => {
		const oldPw = 'previous password previous pw';
		const { identity, record } = await generateIdentity(oldPw);
		const rewrapped = await reEncryptIdentity(identity, 'a different password here', record.idc);
		await expect(unlockIdentity(rewrapped, oldPw)).rejects.toThrow('wrong password');
	});

	it('rejects when the identity does not match the expected commitment', async () => {
		const { record } = await generateIdentity('some password some password');
		const other = new Identity('a-completely-different-identity');
		expect(other.commitment.toString()).not.toBe(record.idc);
		await expect(
			reEncryptIdentity(other, 'new password new password', record.idc)
		).rejects.toThrow('does not match the account commitment');
	});
});

describe('wire encoding', () => {
	it('encode → decode preserves bytes exactly', async () => {
		const { record } = await generateIdentity('round trip password 12345678');
		const wire = encodeForWire(record);
		const decoded = decodeFromWire(wire);
		expect(decoded.ciphertext).toEqual(record.ciphertext);
		expect(decoded.salt).toEqual(record.salt);
		expect(decoded.nonce).toEqual(record.nonce);
		expect(decoded.kdfParams).toEqual(record.kdfParams);
	});

	it('decoded blob unlocks with the original password', async () => {
		const pw = 'wire-format password 1234567890';
		const { record, identity } = await generateIdentity(pw);
		const wire = encodeForWire(record);
		const decoded = decodeFromWire(wire);
		const unlocked = await unlockIdentity(
			{ ...decoded, ciphertext: decoded.ciphertext, salt: decoded.salt, nonce: decoded.nonce },
			pw
		);
		expect(unlocked.commitment.toString()).toBe(identity.commitment.toString());
	});

	it('encoded blob contains only base64url-safe characters', async () => {
		const { record } = await generateIdentity('encode-safety password 12345');
		const wire = encodeForWire(record);
		expect(wire.ciphertext).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(wire.salt).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(wire.nonce).toMatch(/^[A-Za-z0-9_-]+$/);
		expect(wire.idc).toMatch(/^\d+$/);
	});

	it('tampered ciphertext fails to decrypt', async () => {
		const pw = 'tamper test pw tamper test pw';
		const { record } = await generateIdentity(pw);
		const flipped = new Uint8Array(record.ciphertext);
		flipped[0] ^= 0x01;
		await expect(unlockIdentity({ ...record, ciphertext: flipped }, pw)).rejects.toThrow();
	});

	it('tampered nonce fails to decrypt', async () => {
		const pw = 'nonce tamper pw nonce tamper pw';
		const { record } = await generateIdentity(pw);
		const flipped = new Uint8Array(record.nonce);
		flipped[0] ^= 0x01;
		await expect(unlockIdentity({ ...record, nonce: flipped }, pw)).rejects.toThrow();
	});
});

describe('session cache', () => {
	it('round-trips an identity via sessionStorage', () => {
		const id = new Identity('cache-seed');
		cacheUnlockedIdentity(id);
		const back = getCachedIdentity();
		expect(back).not.toBeNull();
		expect(back!.commitment.toString()).toBe(id.commitment.toString());
	});

	it('clearCachedIdentity removes the entry', () => {
		const id = new Identity('clear-seed');
		cacheUnlockedIdentity(id);
		expect(getCachedIdentity()).not.toBeNull();
		clearCachedIdentity();
		expect(getCachedIdentity()).toBeNull();
	});

	it('returns null when nothing is cached', () => {
		clearCachedIdentity();
		expect(getCachedIdentity()).toBeNull();
	});
});
