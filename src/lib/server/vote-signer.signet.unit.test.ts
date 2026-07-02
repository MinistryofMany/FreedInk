// Vote-signer backend SELECTION (FreedInk-level), without a live Signet.
//
// Post-migration, the Signer implementations (LocalSigner / RemoteSigner) and
// their pending / rate-limit / enqueue-once / pubkey-cache behavior live in
// @ministryofmany/blind-token and are covered by that package's own suite. What
// stays FreedInk's responsibility — and what this test locks down — is the
// env-driven SELECTION: SIGNET_URL (+ mTLS certs) → the remote (Signet) backend,
// else the local in-process backend, resolved via signetConfig(). The live
// end-to-end Signet proof lives in tests/integration/signet-vote-signer.test.ts
// (env-gated).

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted; build the mutable env via vi.hoisted so a test can flip
// SIGNET_URL between cases (matches signet.config.unit.test.ts).
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

// The KeyStore/IssuanceStore are Drizzle impls over db/client; stub them so this
// stays a pure unit test (no DB connection at module load).
vi.mock('$lib/db/vote-tokens', () => ({ freedinkKeyStore: {}, freedinkIssuanceStore: {} }));
vi.mock('./log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const CERT = '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';

import { getVoteSigner, _resetVoteSignerForTests } from './vote-signer';
import { _resetSignetConfigForTests } from './signet';

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	_resetSignetConfigForTests();
	_resetVoteSignerForTests();
});

describe('vote signer backend selection', () => {
	it('selects the LOCAL backend when SIGNET_URL is unset', () => {
		expect(getVoteSigner().backend).toBe('local');
	});

	it('selects the REMOTE (Signet) backend when SIGNET_URL + inline mTLS certs are set', () => {
		mockEnv.SIGNET_URL = 'https://signet.test:8443';
		mockEnv.SIGNET_CLIENT_CERT = CERT;
		mockEnv.SIGNET_CLIENT_KEY = KEY;
		mockEnv.SIGNET_CA_CERT = CERT;
		expect(getVoteSigner().backend).toBe('remote');
	});

	it('memoizes the signer once selected (single process-wide backend)', () => {
		const a = getVoteSigner();
		const b = getVoteSigner();
		expect(a).toBe(b);
	});
});
