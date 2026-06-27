// signetConfig() env-gating: unset SIGNET_URL → null (local fallback); set but
// with incomplete mTLS material → throw (fail loud, never silently degrade to
// no-mTLS). The env module is mocked per-case via a mutable object.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above top-level vars, so build the mutable env via
// vi.hoisted (which IS hoisted with it) and reference it from the factory.
const { mockEnv } = vi.hoisted(() => ({ mockEnv: {} as Record<string, string | undefined> }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const CERT = '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----';

import { signetConfig, _resetSignetConfigForTests } from './signet';

beforeEach(() => {
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	_resetSignetConfigForTests();
});

describe('signetConfig env-gating', () => {
	it('returns null when SIGNET_URL is unset (→ local fallback)', () => {
		expect(signetConfig()).toBeNull();
	});

	it('returns a config when SIGNET_URL + inline PEM certs are set', () => {
		mockEnv.SIGNET_URL = 'https://signet:8443/';
		mockEnv.SIGNET_CLIENT_CERT = CERT;
		mockEnv.SIGNET_CLIENT_KEY = KEY;
		mockEnv.SIGNET_CA_CERT = CERT;
		const cfg = signetConfig();
		expect(cfg).not.toBeNull();
		// Trailing slash trimmed.
		expect(cfg!.baseUrl).toBe('https://signet:8443');
		expect(cfg!.clientCert).toBe(CERT);
		expect(cfg!.clientKey).toBe(KEY);
		expect(cfg!.caCert).toBe(CERT);
	});

	it('throws when SIGNET_URL is set but the mTLS material is incomplete', () => {
		mockEnv.SIGNET_URL = 'https://signet:8443';
		mockEnv.SIGNET_CLIENT_CERT = CERT;
		// SIGNET_CLIENT_KEY + SIGNET_CA_CERT missing.
		expect(() => signetConfig()).toThrow(
			/SIGNET_CLIENT_CERT, SIGNET_CLIENT_KEY, and SIGNET_CA_CERT/
		);
	});
});
