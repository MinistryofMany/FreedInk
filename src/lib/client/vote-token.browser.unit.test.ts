// Verify the partially-blind RSA CLIENT operations (prepare/blind/finalize) work
// under jsdom (a browser-like environment). This is load-bearing: FreedInk's
// vote client runs in the browser, and the partially-blind scheme uses a large
// derived public exponent that WebCrypto refuses — the library falls back to its
// bundled sjcl for those ops, which must work everywhere. The vote-token-verify
// step runs server-side (Node), so this test does NOT exercise verify in-browser.
import { describe, it, expect } from 'vitest';
import { RSAPBSSA, PartiallyBlindRSA } from '@cloudflare/blindrsa-ts';
import { generatePrimeSync } from 'node:crypto';

const SUITE = RSAPBSSA.SHA384.PSS.Randomized();

function fastSafePrime(length: number): bigint {
	return generatePrimeSync(length, { safe: true, bigint: true });
}

describe('partially-blind RSA client ops under jsdom', () => {
	it('prepare → blind → (server blindSign) → finalize → (server verify) round-trips', async () => {
		// Use a 1024-bit key to keep the test fast; the protocol logic is
		// size-independent. Production uses 2048.
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

		// CLIENT (jsdom): finalize → unblinded signature.
		const signature = await SUITE.finalize(publicKey, prepared, info, blindSig, inv);
		expect(signature.length).toBeGreaterThan(0);

		// SERVER: verify.
		expect(await SUITE.verify(publicKey, signature, prepared, info)).toBe(true);
		// Cross-version replay is impossible: a different info fails.
		expect(
			await SUITE.verify(publicKey, signature, prepared, new TextEncoder().encode('other'))
		).toBe(false);
	}, 30_000);
});
