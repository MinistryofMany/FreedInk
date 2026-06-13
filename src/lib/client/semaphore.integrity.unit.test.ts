import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Identity } from '@semaphore-protocol/identity';
import snarkLock from '../../../snark-artifacts.lock.json';

// Fix 3 (runtime artifact integrity): buildProof must SHA-256-verify the
// fetched wasm/zkey against the pinned hashes in snark-artifacts.lock.json
// before proving, and must NOT silently fall back to the live CDN. These tests
// drive the fetch layer to prove the integrity gate fires.

const generateProofSpy = vi.fn(async () => {
	throw new Error('generateProof should not run when integrity fails');
});

// Stub the lazily-imported prover so buildProof's loadProver() resolves
// without pulling in snarkjs. The real Group is needed for a valid Merkle
// proof, so we re-export the genuine Group and only fake generateProof.
vi.mock('@semaphore-protocol/proof', () => ({ generateProof: generateProofSpy }));

let semaphore: typeof import('./semaphore');
let realFetch: typeof globalThis.fetch;

beforeEach(async () => {
	vi.resetModules();
	generateProofSpy.mockClear();
	realFetch = globalThis.fetch;
	semaphore = await import('./semaphore');
});

afterEach(() => {
	globalThis.fetch = realFetch;
});

function makeGroupOfTwo() {
	// Two members => Merkle depth 1 => artifacts for depth "1" are consulted.
	const me = new Identity('secret-a');
	const other = new Identity('secret-b');
	return { me, identities: [me.commitment.toString(), other.commitment.toString()] };
}

// jsdom's Response.arrayBuffer() does not always hand back a real ArrayBuffer
// (which crypto.subtle.digest requires), so we build a minimal response stub
// exposing exactly the fields fetchAndVerify reads.
function okResponse(bytes: Uint8Array): Response {
	const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
	return {
		ok: true,
		status: 200,
		statusText: 'OK',
		arrayBuffer: async () => ab
	} as unknown as Response;
}

function errorResponse(status: number, statusText: string): Response {
	return {
		ok: false,
		status,
		statusText,
		arrayBuffer: async () => new ArrayBuffer(0)
	} as unknown as Response;
}

describe('buildProof artifact integrity', () => {
	it('throws when fetched artifact bytes do not match the pinned sha256', async () => {
		// Any bytes we return here will not hash to the pinned digest, so the
		// integrity check must reject them.
		globalThis.fetch = vi.fn(async () =>
			okResponse(new Uint8Array([1, 2, 3, 4]))
		) as unknown as typeof fetch;

		const { me, identities } = makeGroupOfTwo();
		await expect(
			semaphore.buildProof({ identity: me, identities, scope: 's', message: 'm' })
		).rejects.toThrow(/integrity check failed/i);
		expect(generateProofSpy).not.toHaveBeenCalled();
	});

	it('throws (not silently falls back to a CDN) when the local fetch 404s', async () => {
		globalThis.fetch = vi.fn(async () =>
			errorResponse(404, 'Not Found')
		) as unknown as typeof fetch;

		const { me, identities } = makeGroupOfTwo();
		await expect(
			semaphore.buildProof({ identity: me, identities, scope: 's', message: 'm' })
		).rejects.toThrow(/failed to fetch artifact/i);
		expect(generateProofSpy).not.toHaveBeenCalled();
	});

	it('only ever requests the same-origin /snark-artifacts path (no live CDN)', async () => {
		const fetchSpy = vi.fn(async () => okResponse(new Uint8Array([0]))) as unknown as typeof fetch;
		globalThis.fetch = fetchSpy;

		const { me, identities } = makeGroupOfTwo();
		await semaphore
			.buildProof({ identity: me, identities, scope: 's', message: 'm' })
			.catch(() => {});

		const calls = (fetchSpy as unknown as { mock: { calls: unknown[][] } }).mock.calls;
		expect(calls.length).toBeGreaterThan(0);
		for (const [url] of calls) {
			expect(String(url)).toContain('/snark-artifacts/semaphore/');
			expect(String(url)).not.toContain('snark-artifacts.pse.dev');
		}
	});
});

describe('snark-artifacts.lock.json pinning', () => {
	it('exposes a sha256 for depth 1 wasm and zkey (used by the integrity check)', () => {
		const entry = (
			snarkLock.artifacts as Record<string, { wasm: { sha256: string }; zkey: { sha256: string } }>
		)['1'];
		expect(entry).toBeTruthy();
		expect(entry.wasm.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(entry.zkey.sha256).toMatch(/^[0-9a-f]{64}$/);
	});
});
