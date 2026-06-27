// Blind-signature voting tokens (Privacy Pass-style), CLIENT side. Runs in the
// browser. The heavy crypto (partially-blind RSA via @cloudflare/blindrsa-ts +
// its bundled sjcl) is lazy-loaded so it isn't in the initial chunk of the post
// page — most readers never vote.
//
// Two steps, mirroring the server:
//   1. requestAndBuildToken(versionId): authenticated issuance. Generate a random
//      nonce, blind it under the version metadata, ask the server to blind-sign,
//      finalize to an unblinded signature. Returns the material needed to redeem.
//      This step sends the session cookie (issuance is authenticated).
//   2. castVote(...): anonymous redemption. POST the signature + prepared nonce +
//      vote with credentials:'omit' (no session) to the vote endpoint.
//
// The server verifies the signature over (versionId, preparedNonce); issuance and
// redemption are unlinkable under the blind signature.

type Suite = Awaited<ReturnType<typeof loadSuite>>['suite'];

let suiteLoad: Promise<{ suite: Suite }> | null = null;
async function loadSuite() {
	const { RSAPBSSA } = await import('@cloudflare/blindrsa-ts');
	return { suite: RSAPBSSA.SHA384.PSS.Randomized() };
}
function getSuite() {
	suiteLoad ??= loadSuite();
	return suiteLoad;
}

function bytesToB64url(b: Uint8Array): string {
	let s = '';
	for (const x of b) s += String.fromCharCode(x);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBytes(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// Same metadata the server binds (must match $lib/server/vote-token.versionInfo).
function versionInfo(versionId: string): Uint8Array {
	return new TextEncoder().encode(`freedink-vote:${versionId}`);
}

export type RedeemableToken = {
	// base64url unblinded signature, ready to redeem.
	signature: string;
	// base64url prepared nonce bytes (what was signed); the server verifies over
	// these and derives the anonymous token nonce from them.
	preparedNonce: string;
};

// Step 1 — authenticated issuance. Blinds a fresh random nonce, gets it
// blind-signed, finalizes. Sends the session cookie (default credentials).
export async function requestAndBuildToken(versionId: string): Promise<RedeemableToken> {
	const { suite } = await getSuite();
	const info = versionInfo(versionId);

	// Fresh random nonce; prepare (adds randomness for the Randomized variant).
	const nonce = crypto.getRandomValues(new Uint8Array(32));
	const prepared = suite.prepare(nonce);

	// blind() needs the issuer public key, so fetch it via a cheap preflight (no
	// token consumed) before blinding. The key is per-blog and stable, so this is
	// effectively a one-time fetch the browser caches.
	const pubKeyB64 = await fetchIssuerPublicKey(versionId);
	const pub = await importPub(pubKeyB64);
	const { blindedMsg, inv } = await suite.blind(pub, prepared, info);

	// Authenticated issuance: send the blinded message; receive the blind sig.
	const res = await fetch('/api/blog/vote-token', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			post_version_id: versionId,
			blinded_message: bytesToB64url(blindedMsg)
		})
	});
	if (!res.ok) throw new Error(await res.text());
	const { blind_signature } = await res.json();
	const blindSig = b64urlToBytes(blind_signature);

	const signature = await suite.finalize(pub, prepared, info, blindSig, inv);
	return {
		signature: bytesToB64url(signature),
		preparedNonce: bytesToB64url(prepared)
	};
}

// Preflight: fetch the blog's issuer public key for a version (no token consumed).
async function fetchIssuerPublicKey(versionId: string): Promise<string> {
	const res = await fetch(
		`/api/blog/vote-token/key?post_version_id=${encodeURIComponent(versionId)}`
	);
	if (!res.ok) throw new Error(await res.text());
	const { public_key } = await res.json();
	return public_key;
}

async function importPub(b64: string): Promise<CryptoKey> {
	const spki = b64urlToBytes(b64);
	return crypto.subtle.importKey(
		'spki',
		spki as unknown as ArrayBuffer,
		{ name: 'RSA-PSS', hash: 'SHA-384' },
		true,
		['verify']
	);
}

// Step 2 — anonymous redemption (the vote). Session-free: credentials omitted.
export async function castVote(opts: {
	versionId: string;
	token: RedeemableToken;
	vote: 'approve' | 'reject';
	comment?: string;
	rejectionReasons?: string[];
}): Promise<Response> {
	return fetch('/api/post/review', {
		method: 'POST',
		// Anonymous redemption: never attach the session cookie.
		credentials: 'omit',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			post_version_id: opts.versionId,
			vote: opts.vote,
			comment: opts.comment,
			rejection_reasons: opts.rejectionReasons,
			signature: opts.token.signature,
			prepared_nonce: opts.token.preparedNonce
		})
	});
}
