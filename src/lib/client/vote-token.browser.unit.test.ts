// Verify the partially-blind RSA CLIENT finalize works under jsdom (a
// browser-like environment) AND stays byte-compatible with the vetted library.
//
// This is load-bearing: FreedInk's vote client runs in the browser, and
// @cloudflare/blindrsa-ts@0.4.6's own suite.finalize() throws an OperationError
// in Chromium — it imports the 1024-bit per-metadata DERIVED public key into
// WebCrypto, which BoringSSL rejects (Node/OpenSSL accepts it, so it passed
// Node-only tests). Our finalizeInBrowser computes the signature arithmetically
// and runs the RFC 9474 self-check without that key import.
//
// The CRITICAL invariant proven here: finalizeInBrowser produces a signature
// BYTE-IDENTICAL to the library's suite.finalize, and the result verifies under
// the server's suite.verify. That is what guarantees the wire scheme is
// unchanged (Signet interop) — we changed only the client import mechanics.
import { describe, it, expect } from 'vitest';
import { RSAPBSSA, PartiallyBlindRSA } from '@cloudflare/blindrsa-ts';
import { generatePrimeSync } from 'node:crypto';
import { __testing } from './vote-token';

const SUITE = RSAPBSSA.SHA384.PSS.Randomized();

function fastSafePrime(length: number): bigint {
	return generatePrimeSync(length, { safe: true, bigint: true });
}

describe('partially-blind RSA client finalize under jsdom', () => {
	it('finalizeInBrowser matches the library finalize byte-for-byte and verifies', async () => {
		// Use a 1024-bit key to keep the test fast; the derived exponent is still
		// 512 bits (> WebCrypto's ~32-bit bound), so it exercises the same code path
		// the production 2048-bit key hits. Protocol logic is size-independent.
		const { privateKey, publicKey } = await PartiallyBlindRSA.generateKey(
			{ modulusLength: 1024, publicExponent: Uint8Array.from([1, 0, 1]), hash: 'SHA-384' },
			fastSafePrime
		);
		const info = new TextEncoder().encode('freedink-vote:version-xyz');

		// CLIENT (jsdom): blind a random nonce.
		const nonce = crypto.getRandomValues(new Uint8Array(32));
		const prepared = SUITE.prepare(nonce);
		const { blindedMsg, inv } = await SUITE.blind(publicKey, prepared, info);
		expect(blindedMsg.length).toBeGreaterThan(0);

		// SERVER: blind-sign.
		const blindSig = await SUITE.blindSign(privateKey, blindedMsg, info);

		// CLIENT (jsdom): our Chromium-safe finalize.
		const mine = await __testing.finalizeInBrowser(publicKey, prepared, info, blindSig, inv);
		// The library's finalize, for the byte-for-byte comparison (works under Node).
		const lib = await SUITE.finalize(publicKey, prepared, info, blindSig, inv);

		expect(mine.length).toBe(lib.length);
		expect(Array.from(mine)).toEqual(Array.from(lib));

		// SERVER: verify our signature with the UNMODIFIED library (wire compat).
		expect(await SUITE.verify(publicKey, mine, prepared, info)).toBe(true);
		// Cross-version replay is impossible: a different info fails.
		expect(await SUITE.verify(publicKey, mine, prepared, new TextEncoder().encode('other'))).toBe(
			false
		);
	}, 30_000);

	it('finalizeInBrowser rejects a tampered blind signature (self-check intact)', async () => {
		const { privateKey, publicKey } = await PartiallyBlindRSA.generateKey(
			{ modulusLength: 1024, publicExponent: Uint8Array.from([1, 0, 1]), hash: 'SHA-384' },
			fastSafePrime
		);
		const info = new TextEncoder().encode('freedink-vote:tamper');
		const prepared = SUITE.prepare(crypto.getRandomValues(new Uint8Array(32)));
		const { blindedMsg, inv } = await SUITE.blind(publicKey, prepared, info);
		const blindSig = await SUITE.blindSign(privateKey, blindedMsg, info);

		const tampered = blindSig.slice();
		tampered[3] ^= 0x80;
		await expect(
			__testing.finalizeInBrowser(publicKey, prepared, info, tampered, inv)
		).rejects.toThrow(/invalid signature/);
	}, 30_000);
});
