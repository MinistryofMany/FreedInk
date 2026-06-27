import { BASE_URL } from '../setup/server';
import { createSession, packCookie } from '$lib/server/session';
import type { TestUser } from '../setup/factories';

export { BASE_URL };

// Build a request init with the cookie header for a user, optionally with a
// JSON body. Returns a wrapper that auto-prepends BASE_URL.
export function api(path: string, opts: RequestInit = {}): Promise<Response> {
	const url = path.startsWith('http') ? path : BASE_URL + path;
	return fetch(url, opts);
}

export async function asUser(user: TestUser): Promise<{ cookie: string }> {
	const sid = await createSession(user.id, { userAgent: 'vitest', ip: '127.0.0.1' });
	return { cookie: `sid=${packCookie(sid)}` };
}

export async function postJSON(
	path: string,
	body: unknown,
	opts: { cookie?: string } = {}
): Promise<Response> {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (opts.cookie) headers.cookie = opts.cookie;
	return api(path, {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});
}

export async function getJSON(path: string, opts: { cookie?: string } = {}): Promise<Response> {
	const headers: Record<string, string> = {};
	if (opts.cookie) headers.cookie = opts.cookie;
	return api(path, { headers });
}

// ─────────────── blind-token vote helper (Phase 5) ───────────────
//
// Perform the full vote flow against the running server: (1) authenticated
// issuance (key preflight + blind-sign), (2) anonymous redemption. Mirrors the
// browser client in $lib/client/vote-token. Used by API tests that previously
// cast a vote via a Semaphore proof.
function bytesToB64url(b: Uint8Array): string {
	return Buffer.from(b).toString('base64url');
}
function b64urlToBytes(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	return new Uint8Array(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64'));
}

// Build (issue + finalize) a redeemable token for a version as the given user.
// Returns { signature, preparedNonce } (base64url) ready for redemption, or
// throws with the server error text if issuance fails (e.g. not eligible, or a
// token was already issued).
export async function buildVoteToken(
	versionId: string,
	cookie: string
): Promise<{ signature: string; preparedNonce: string }> {
	const { RSAPBSSA } = await import('@cloudflare/blindrsa-ts');
	const suite = RSAPBSSA.SHA384.PSS.Randomized();
	const info = new TextEncoder().encode(`freedink-vote:${versionId}`);

	// Preflight: fetch the issuer public key.
	const keyRes = await api(
		`/api/blog/vote-token/key?post_version_id=${encodeURIComponent(versionId)}`,
		{ headers: { cookie } }
	);
	if (!keyRes.ok) throw new Error(`key preflight failed ${keyRes.status}: ${await keyRes.text()}`);
	const { public_key } = await keyRes.json();
	const pub = await crypto.subtle.importKey(
		'spki',
		b64urlToBytes(public_key) as unknown as ArrayBuffer,
		{ name: 'RSA-PSS', hash: 'SHA-384' },
		true,
		['verify']
	);

	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const prepared = suite.prepare(nonce);
	const { blindedMsg, inv } = await suite.blind(pub, prepared, info);

	const issueRes = await api('/api/blog/vote-token', {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify({
			post_version_id: versionId,
			blinded_message: bytesToB64url(blindedMsg)
		})
	});
	if (!issueRes.ok) throw new Error(`issuance failed ${issueRes.status}: ${await issueRes.text()}`);
	const { blind_signature } = await issueRes.json();
	const signature = await suite.finalize(pub, prepared, info, b64urlToBytes(blind_signature), inv);

	return { signature: bytesToB64url(signature), preparedNonce: bytesToB64url(prepared) };
}

// Redeem a token to cast a vote (session-free; credentials omitted by not sending
// a cookie). `token` comes from buildVoteToken. Returns the raw Response.
export async function redeemVote(opts: {
	versionId: string;
	token: { signature: string; preparedNonce: string };
	vote: 'approve' | 'reject';
	comment?: string;
	rejectionReasons?: string[];
}): Promise<Response> {
	return postJSON('/api/post/review', {
		post_version_id: opts.versionId,
		vote: opts.vote,
		comment: opts.comment,
		rejection_reasons: opts.rejectionReasons,
		signature: opts.token.signature,
		prepared_nonce: opts.token.preparedNonce
	});
}

// Convenience: build a token (as `cookie`'s user) and redeem it in one call.
export async function castTokenVote(opts: {
	versionId: string;
	cookie: string;
	vote: 'approve' | 'reject';
	comment?: string;
	rejectionReasons?: string[];
}): Promise<Response> {
	const token = await buildVoteToken(opts.versionId, opts.cookie);
	return redeemVote({
		versionId: opts.versionId,
		token,
		vote: opts.vote,
		comment: opts.comment,
		rejectionReasons: opts.rejectionReasons
	});
}
