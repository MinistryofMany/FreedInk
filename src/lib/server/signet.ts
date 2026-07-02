// Signet configuration (mTLS material + base URL), resolved from env.
//
// The Signet HTTP transport itself now lives in @ministryofmany/blind-token's
// RemoteSigner (node:https Agent, base64 wire, /sign + /key endpoints), lifted
// byte-for-byte from FreedInk's former transport. What STAYS FreedInk-specific is
// this env read + PEM resolution: whether Signet is configured at all (SIGNET_URL
// present), and turning the SIGNET_* env into the resolved PEM strings the
// RemoteSigner takes. A deployment that leaves SIGNET_URL unset never builds a
// RemoteSigner and runs the in-process LocalSigner instead.

import { env } from '$env/dynamic/private';
import { readFileSync } from 'node:fs';

export interface SignetConfig {
	// Base URL of the signer, e.g. https://signet:8443 (no trailing slash).
	baseUrl: string;
	// PEM bytes (NOT paths) for the mTLS material, resolved at config time.
	clientCert: string;
	clientKey: string;
	caCert: string;
}

// Resolve a PEM value that may be given either inline (the value starts with
// "-----BEGIN") or as a filesystem path. Inline lets containers inject secrets
// directly; a path lets a compose mount supply a file. Returns null if absent.
function resolvePem(value: string | undefined): string | null {
	if (!value) return null;
	const trimmed = value.trim();
	if (trimmed.startsWith('-----BEGIN')) return value;
	// Treat as a path. Let a read error surface — a misconfigured cert path must
	// fail loudly at startup, never silently degrade to no-mTLS.
	return readFileSync(trimmed, 'utf8');
}

// Read the Signet configuration from env. Returns null when SIGNET_URL is unset
// (→ the caller falls back to local in-process signing). When SIGNET_URL IS set
// but the mTLS material is incomplete, we throw: a half-configured Signet is an
// operator error that must not silently fall back to the insecure local path.
let configCache: { value: SignetConfig | null } | null = null;

export function signetConfig(): SignetConfig | null {
	if (configCache) return configCache.value;
	const baseUrl = env.SIGNET_URL?.trim();
	if (!baseUrl) {
		configCache = { value: null };
		return null;
	}
	const clientCert = resolvePem(env.SIGNET_CLIENT_CERT);
	const clientKey = resolvePem(env.SIGNET_CLIENT_KEY);
	const caCert = resolvePem(env.SIGNET_CA_CERT);
	if (!clientCert || !clientKey || !caCert) {
		throw new Error(
			'SIGNET_URL is set but SIGNET_CLIENT_CERT, SIGNET_CLIENT_KEY, and SIGNET_CA_CERT are required for mTLS'
		);
	}
	const value: SignetConfig = {
		baseUrl: baseUrl.replace(/\/$/, ''),
		clientCert,
		clientKey,
		caCert
	};
	configCache = { value };
	return value;
}

// Test-only: drop the memoized config so a test can flip env between cases.
export function _resetSignetConfigForTests(): void {
	configCache = null;
}
