// SignetVoteSigner — pending / rate-limit / pre-gen handling, WITHOUT a live
// Signet. The HTTP/mTLS layer (./signet) is mocked so this runs in the default
// unit project (no network, no DB). The live end-to-end proof lives in
// tests/integration/signet-vote-signer.test.ts (env-gated).
//
// What this locks down:
//   - getPublicKey() returns `pending` while keygen runs, and enqueues POST /key
//     AT MOST ONCE per process (no poll-loop thrash that wedged keygen);
//   - once ready, the SPKI is cached and not re-fetched;
//   - sign() maps Signet's 202 → pending and 429 → rate_limited, and enqueues at
//     most once on pending;
//   - ensureKey() enqueues and caches a ready key (the pre-gen path);
//   - the abstraction selects the Signet backend when SIGNET_URL is configured.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock env so signetConfig() sees a configured Signet (the cert values are PEM
// inline so resolvePem doesn't touch the filesystem).
vi.mock('$env/dynamic/private', () => ({
	env: {
		SIGNET_URL: 'https://signet.test:8443',
		SIGNET_CLIENT_CERT: '-----BEGIN CERTIFICATE-----\nclient\n-----END CERTIFICATE-----',
		SIGNET_CLIENT_KEY: '-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----',
		SIGNET_CA_CERT: '-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----'
	}
}));

vi.mock('$app/environment', () => ({ browser: false, dev: true }));

// Mock the Signet HTTP wrappers. These are what SignetVoteSigner calls.
const signetGetKey = vi.fn();
const signetCreateKey = vi.fn();
const signetSign = vi.fn();
vi.mock('./signet', () => ({
	signetConfig: () => ({
		baseUrl: 'https://signet.test:8443',
		clientCert: 'c',
		clientKey: 'k',
		caCert: 'ca'
	}),
	signetGetKey: (...a: unknown[]) => signetGetKey(...a),
	signetCreateKey: (...a: unknown[]) => signetCreateKey(...a),
	signetSign: (...a: unknown[]) => signetSign(...a)
}));

// vote-signer imports these for the LOCAL path; stub them so the module loads.
vi.mock('$lib/db/vote-tokens', () => ({
	getOrCreateVoteTokenKey: vi.fn(),
	getVoteTokenPublicKey: vi.fn(),
	ensureLocalVoteTokenKey: vi.fn()
}));
vi.mock('./vote-token', () => ({ blindSignVoteToken: vi.fn() }));
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getVoteSigner, _resetVoteSignerForTests } from './vote-signer';

const SPKI = new Uint8Array([1, 2, 3, 4]);
const SIG = new Uint8Array([9, 9, 9]);

beforeEach(() => {
	_resetVoteSignerForTests();
	signetGetKey.mockReset();
	signetCreateKey.mockReset();
	signetSign.mockReset();
});

describe('SignetVoteSigner (mocked transport)', () => {
	it('selects the signet backend when SIGNET_URL is set', () => {
		expect(getVoteSigner().backend).toBe('signet');
	});

	it('getPublicKey returns pending while keygen runs and enqueues POST /key at most once', async () => {
		signetGetKey.mockResolvedValue({ status: 'pending' });
		signetCreateKey.mockResolvedValue({ status: 'pending' });
		const signer = getVoteSigner();

		// Three pending polls in a row …
		expect(await signer.getPublicKey('blog-1')).toEqual({ status: 'pending' });
		expect(await signer.getPublicKey('blog-1')).toEqual({ status: 'pending' });
		expect(await signer.getPublicKey('blog-1')).toEqual({ status: 'pending' });

		// … must NOT spam POST /key (that thrashes Signet's keygen worker). Enqueue
		// exactly once for this group.
		expect(signetCreateKey).toHaveBeenCalledTimes(1);
		expect(signetCreateKey).toHaveBeenCalledWith(expect.anything(), 'blog-1');
	});

	it('getPublicKey caches a ready key and does not re-fetch', async () => {
		signetGetKey.mockResolvedValue({ status: 'ready', publicKeySpki: SPKI, keyId: 'k1' });
		const signer = getVoteSigner();

		const a = await signer.getPublicKey('blog-2');
		const b = await signer.getPublicKey('blog-2');
		expect(a).toEqual({ status: 'ready', publicKeySpki: SPKI });
		expect(b).toEqual({ status: 'ready', publicKeySpki: SPKI });
		// Fetched once; the second call hit the cache.
		expect(signetGetKey).toHaveBeenCalledTimes(1);
	});

	it('sign maps ok / pending / rate_limited correctly', async () => {
		const signer = getVoteSigner();
		const args = {
			blogId: 'blog-3',
			participantId: 'u1',
			versionId: 'v1',
			blindedMessage: new Uint8Array([7])
		};

		signetSign.mockResolvedValueOnce({ status: 'pending' });
		expect(await signer.sign(args)).toEqual({ status: 'pending' });

		signetSign.mockResolvedValueOnce({ status: 'rate_limited' });
		expect(await signer.sign(args)).toEqual({ status: 'rate_limited' });

		signetSign.mockResolvedValueOnce({ status: 'ok', blindSignature: SIG });
		expect(await signer.sign(args)).toEqual({ status: 'ok', blindSignature: SIG });
	});

	it('sign enqueues POST /key at most once across repeated pending results', async () => {
		signetCreateKey.mockResolvedValue({ status: 'pending' });
		signetSign.mockResolvedValue({ status: 'pending' });
		const signer = getVoteSigner();
		const args = {
			blogId: 'blog-4',
			participantId: 'u1',
			versionId: 'v1',
			blindedMessage: new Uint8Array([7])
		};
		await signer.sign(args);
		await signer.sign(args);
		await signer.sign(args);
		expect(signetCreateKey).toHaveBeenCalledTimes(1);
	});

	it('ensureKey enqueues and caches a ready key (pre-gen path)', async () => {
		signetCreateKey.mockResolvedValue({ status: 'ready', publicKeySpki: SPKI, keyId: 'k1' });
		const signer = getVoteSigner();

		await signer.ensureKey('blog-5');
		expect(signetCreateKey).toHaveBeenCalledWith(expect.anything(), 'blog-5');

		// After a ready ensureKey, getPublicKey is served from cache (no GET /key).
		const pk = await signer.getPublicKey('blog-5');
		expect(pk).toEqual({ status: 'ready', publicKeySpki: SPKI });
		expect(signetGetKey).not.toHaveBeenCalled();
	});

	it('ensureKey failure is swallowed and lets a later enqueue retry', async () => {
		signetCreateKey.mockRejectedValueOnce(new Error('signet down'));
		const signer = getVoteSigner();
		// Does not throw.
		await expect(signer.ensureKey('blog-6')).resolves.toBeUndefined();

		// A subsequent pending getPublicKey can re-enqueue (the marker was cleared).
		signetGetKey.mockResolvedValue({ status: 'pending' });
		signetCreateKey.mockResolvedValue({ status: 'pending' });
		await signer.getPublicKey('blog-6');
		expect(signetCreateKey).toHaveBeenCalledTimes(2); // failed attempt + retry
	});
});
