// Signet HTTP client (mTLS). Talks to the optional external blind-signing
// service. This module is ONLY imported when SIGNET_URL is configured (see
// vote-signer.ts); a deployment that leaves the Signet env vars unset never
// loads it and runs the in-process LocalVoteSigner instead.
//
// Transport: Node's built-in `node:https` with an https.Agent carrying the
// client cert/key + the CA that signed Signet's server cert. We deliberately do
// NOT use the global fetch + undici here: undici is only a transitive dev-time
// dependency (jsdom) in this repo, so relying on it at runtime would be fragile.
// `node:https` is a stable core module and works under adapter-node.
//
// The anonymity invariant lives one layer up (SignetVoteSigner): this module is
// a dumb transport. It forwards the already-blinded message bytes and never sees
// the raw nonce. It also never logs request/response bodies.

import { Agent, request as httpsRequest } from 'node:https';
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
	agentCache = null;
}

// One Agent per process (keep-alive pooled). The Agent holds the client identity
// for mTLS; Signet pins our cert CN, so the same cert is presented every call.
let agentCache: Agent | null = null;

function agentFor(cfg: SignetConfig): Agent {
	if (agentCache) return agentCache;
	agentCache = new Agent({
		cert: cfg.clientCert,
		key: cfg.clientKey,
		ca: cfg.caCert,
		keepAlive: true,
		// Verify Signet's server cert against the provided CA (the default), and
		// require the hostname to match the cert SAN. Both are on by default; we
		// state them so a future edit can't silently disable them.
		rejectUnauthorized: true
	});
	return agentCache;
}

export interface SignetResponse {
	status: number;
	// Parsed JSON body, or null for an empty/non-JSON body (e.g. /healthz "ok").
	json: unknown;
	// Raw text (used for error surfacing). Never logged for /sign success bodies.
	text: string;
}

// Low-level request. `path` includes any query string. `body`, when present, is
// JSON-encoded. Returns the status + parsed body without throwing on non-2xx —
// the caller maps status codes (200 / 202 pending / 429) to behavior.
async function signetRequest(
	cfg: SignetConfig,
	method: 'GET' | 'POST',
	path: string,
	body?: unknown
): Promise<SignetResponse> {
	const url = new URL(cfg.baseUrl + path);
	const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body), 'utf8');

	return new Promise<SignetResponse>((resolve, reject) => {
		const req = httpsRequest(
			{
				method,
				hostname: url.hostname,
				port: url.port,
				path: url.pathname + url.search,
				agent: agentFor(cfg),
				headers: {
					accept: 'application/json',
					...(payload
						? { 'content-type': 'application/json', 'content-length': String(payload.length) }
						: {})
				}
			},
			(res) => {
				const chunks: Buffer[] = [];
				res.on('data', (c: Buffer) => chunks.push(c));
				res.on('end', () => {
					const text = Buffer.concat(chunks).toString('utf8');
					let parsed: unknown = null;
					if (text.length > 0) {
						try {
							parsed = JSON.parse(text);
						} catch {
							// Non-JSON body (e.g. /healthz "ok" or a plain error). Leave
							// json null; callers that need JSON treat that as a failure.
							parsed = null;
						}
					}
					resolve({ status: res.statusCode ?? 0, json: parsed, text });
				});
			}
		);
		req.on('error', reject);
		// A hung signer must not wedge a request thread forever.
		req.setTimeout(15_000, () => {
			req.destroy(new Error('Signet request timed out'));
		});
		if (payload) req.write(payload);
		req.end();
	});
}

// ── Endpoint wrappers (typed) ────────────────────────────────────────────────

export type KeyStatus =
	| { status: 'ready'; publicKeySpki: Uint8Array; keyId: string | null }
	| { status: 'pending' };

function b64ToBytes(b64: string): Uint8Array {
	return new Uint8Array(Buffer.from(b64, 'base64'));
}

// GET /key?group_id=… → 200 ready (public_key SPKI base64) | 202 pending.
//
// A 429 on a /key* endpoint (Signet rate-limits key reads per client identity +
// globally) is mapped to `pending`, NOT an error: it means "the key budget is
// busy, retry shortly", which is the same user-facing behavior as a key still
// generating. The caller backs off and re-polls; surfacing it as a hard failure
// would needlessly abort a vote that just needs to wait out the window.
export async function signetGetKey(cfg: SignetConfig, groupId: string): Promise<KeyStatus> {
	const res = await signetRequest(cfg, 'GET', `/key?group_id=${encodeURIComponent(groupId)}`);
	if (res.status === 200) {
		const j = res.json as { public_key?: string; key_id?: string };
		if (!j || typeof j.public_key !== 'string') {
			throw new Error('Signet /key returned 200 without a public_key');
		}
		return { status: 'ready', publicKeySpki: b64ToBytes(j.public_key), keyId: j.key_id ?? null };
	}
	if (res.status === 202 || res.status === 429) return { status: 'pending' };
	throw new Error(`Signet /key failed (${res.status}): ${res.text.slice(0, 200)}`);
}

// POST /key?group_id=… → enqueue keygen (idempotent + deduped). 202 pending or
// 200 ready (already exists). We treat both as success. A 429 (key-endpoint rate
// limit) is also `pending`: the keygen is/was enqueued or will be on a later
// call; the on-demand sign path is the hard guarantee.
export async function signetCreateKey(cfg: SignetConfig, groupId: string): Promise<KeyStatus> {
	const res = await signetRequest(cfg, 'POST', `/key?group_id=${encodeURIComponent(groupId)}`);
	if (res.status === 200) {
		const j = res.json as { public_key?: string; key_id?: string };
		if (j && typeof j.public_key === 'string') {
			return { status: 'ready', publicKeySpki: b64ToBytes(j.public_key), keyId: j.key_id ?? null };
		}
		return { status: 'pending' };
	}
	if (res.status === 202 || res.status === 429) return { status: 'pending' };
	throw new Error(`Signet POST /key failed (${res.status}): ${res.text.slice(0, 200)}`);
}

export type SignResult =
	| { status: 'ok'; blindSignature: Uint8Array }
	| { status: 'pending' }
	// 429: rate-limited (per-participant or global ceiling). The caller surfaces
	// this distinctly from a hard failure.
	| { status: 'rate_limited' };

// POST /sign { group_id, participant_id, version_id, blinded_message(base64) }
// → 200 { blind_signature(base64) } | 202 pending | 429 rate-limited.
//
// blindedMessage is the ALREADY-BLINDED bytes from the browser. The raw nonce is
// never in scope here — anonymity rests on that. We send base64 (Signet's wire
// format) and never log the message or the returned signature.
export async function signetSign(
	cfg: SignetConfig,
	args: {
		groupId: string;
		participantId: string;
		versionId: string;
		blindedMessage: Uint8Array;
	}
): Promise<SignResult> {
	const res = await signetRequest(cfg, 'POST', '/sign', {
		group_id: args.groupId,
		participant_id: args.participantId,
		version_id: args.versionId,
		blinded_message: Buffer.from(args.blindedMessage).toString('base64')
	});
	if (res.status === 200) {
		const j = res.json as { blind_signature?: string };
		if (!j || typeof j.blind_signature !== 'string') {
			throw new Error('Signet /sign returned 200 without a blind_signature');
		}
		return { status: 'ok', blindSignature: b64ToBytes(j.blind_signature) };
	}
	if (res.status === 202) return { status: 'pending' };
	if (res.status === 429) return { status: 'rate_limited' };
	// 400 (bad blinded message), 409 (already signed for this tuple), etc. are
	// real errors the caller must surface, not retry.
	throw new Error(`Signet /sign failed (${res.status}): ${res.text.slice(0, 200)}`);
}
