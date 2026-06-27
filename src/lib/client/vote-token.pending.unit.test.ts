// Client-side pending-state handling: when the issuer key isn't ready yet (async
// pre-gen / Signet keygen), the issuance endpoints return HTTP 202 and the client
// surfaces a VotePendingError so the review page can show "preparing voting…" and
// retry, WITHOUT consuming the user's one-per-(user,version) token.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { requestAndBuildToken, VotePendingError } from './vote-token';

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
	vi.restoreAllMocks();
});

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

describe('requestAndBuildToken pending handling', () => {
	it('throws VotePendingError when the key preflight returns 202 pending', async () => {
		// The key preflight (GET /api/blog/vote-token/key) returns 202 → not ready.
		globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('/vote-token/key')) return jsonResponse(202, { status: 'pending' });
			throw new Error(`unexpected fetch to ${url}`);
		}) as typeof fetch;

		await expect(requestAndBuildToken('v-1')).rejects.toBeInstanceOf(VotePendingError);
	});

	it('throws VotePendingError when the issuance POST returns 202 pending', async () => {
		// Preflight succeeds with a real public key (so blind() runs), but the
		// issuance POST returns 202 → the reservation was rolled back server-side and
		// the client must retry. We import the crypto lazily and build a valid key so
		// suite.blind succeeds before we hit the 202 on POST.
		const { PartiallyBlindRSA } = await import('@cloudflare/blindrsa-ts');
		const { generatePrimeSync, webcrypto } = await import('node:crypto');
		const { publicKey } = await PartiallyBlindRSA.generateKey(
			{ modulusLength: 1024, publicExponent: Uint8Array.from([1, 0, 1]), hash: 'SHA-384' },
			(len: number) => generatePrimeSync(len, { safe: true, bigint: true })
		);
		const spki = new Uint8Array(await webcrypto.subtle.exportKey('spki', publicKey));
		const pubB64url = Buffer.from(spki).toString('base64url');

		globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = typeof input === 'string' ? input : input.toString();
			if (url.includes('/vote-token/key')) return jsonResponse(200, { public_key: pubB64url });
			if (url.endsWith('/api/blog/vote-token') && init?.method === 'POST') {
				return jsonResponse(202, { status: 'pending' });
			}
			throw new Error(`unexpected fetch to ${url}`);
		}) as typeof fetch;

		await expect(requestAndBuildToken('v-2')).rejects.toBeInstanceOf(VotePendingError);
	}, 20_000);
});
