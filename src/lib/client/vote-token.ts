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

// SHA-384 PSS parameters of the suite (RSAPBSSA.SHA384.PSS.Randomized). These
// MUST match the suite the server uses; they are fixed by the scheme and never
// vary at runtime, so we hard-code them rather than reading suite.params (which
// is an internal field).
const HASH = 'SHA-384';
const H_LEN = 48; // SHA-384 digest bytes
const SALT_LEN = 48; // PSS salt length for the SHA384 variant

// ── Chromium-safe finalize ──────────────────────────────────────────────────
//
// WHY THIS EXISTS: @cloudflare/blindrsa-ts@0.4.6 PartiallyBlindRSA.finalize()
// performs its RFC 9474 signature self-check by importing the PER-METADATA
// DERIVED public key into WebCrypto (crypto.subtle.importKey('jwk', …) then
// crypto.subtle.verify). The partially-blind scheme derives a public exponent
// e' that is modulus_bits/2 = 1024 bits long. Chromium's WebCrypto (BoringSSL)
// rejects importing an RSA public key whose exponent exceeds ~32 bits with an
// empty-message OperationError (chromium issue 340178598); Node's WebCrypto
// (OpenSSL) has no such bound, which is why the library's finalize passes under
// Node but throws in a real browser. The bug is present in upstream HEAD too, so
// a version bump does not fix it.
//
// WHAT WE DO INSTEAD: compute the unblinded signature with the exact same
// arithmetic the library uses (s = blind_sig * r^-1 mod n), then run the RFC 9474
// finalize self-check (EMSA-PSS-VERIFY against the derived public key) using the
// library's own bignum primitives — never importing the large-exponent key into
// WebCrypto. The produced signature bytes are BYTE-IDENTICAL to the library's
// finalize output (proven by a unit test that diffs them), so the wire scheme
// (RSAPBSSA.SHA384.PSS.Randomized, public metadata `freedink-vote:<versionId>`)
// is unchanged: the server verifies with the unmodified library, and the Signet
// signing service stays interop-compatible. We do NOT touch what is signed or
// what is verified — only the client-side import mechanics of the self-check.
//
// The self-check is preserved (not skipped): a malformed/garbled blind signature
// from a buggy or hostile issuer is caught here, before the user spends their
// one-per-(user,version) token on a redemption the server would reject anyway.

// Deep imports into the library's internal primitives. The package ships these
// as ESM with .d.ts, and its package.json has no `exports` map, so the subpath
// is resolvable + typed; it is pinned at 0.4.6 (we do not auto-update). sjcl is
// the library's bundled bignum; util holds the same RSAVP1/i2osp/os2ip the
// library uses everywhere, so reusing them keeps us bit-for-bit aligned.
async function loadFinalizeDeps() {
	const [{ default: sjcl }, util] = await Promise.all([
		import('@cloudflare/blindrsa-ts/lib/src/sjcl/index.js'),
		import('@cloudflare/blindrsa-ts/lib/src/util.js')
	]);
	return { sjcl, ...util };
}

// MGF1 (RFC 8017 B.2.1) over SHA-384, used by EMSA-PSS-VERIFY.
async function mgf1(
	sjcl: Awaited<ReturnType<typeof loadFinalizeDeps>>['sjcl'],
	i2osp: Awaited<ReturnType<typeof loadFinalizeDeps>>['i2osp'],
	joinAll: Awaited<ReturnType<typeof loadFinalizeDeps>>['joinAll'],
	seed: Uint8Array,
	maskLen: number
): Promise<Uint8Array> {
	let t = new Uint8Array(0);
	let counter = 0;
	while (t.length < maskLen) {
		const c = i2osp(new sjcl.bn(counter), 4);
		const h = new Uint8Array(await crypto.subtle.digest(HASH, joinAll([seed, c]).slice().buffer));
		t = joinAll([t, h]);
		counter++;
	}
	return t.slice(0, maskLen);
}

// EMSA-PSS-VERIFY (RFC 8017 §9.1.2). Returns whether the encoded message EM is a
// valid PSS encoding of M for the given emBits. Constant-time on the final hash
// compare; the structural checks short-circuit but reveal nothing secret (EM is
// derived from the public signature). This is the same predicate the library's
// crypto.subtle.verify computes — we evaluate it arithmetically so no
// large-exponent key import is needed.
async function emsaPssVerify(
	deps: Awaited<ReturnType<typeof loadFinalizeDeps>>,
	m: Uint8Array,
	em: Uint8Array,
	emBits: number
): Promise<boolean> {
	const { sjcl, i2osp, joinAll } = deps;
	const emLen = Math.ceil(emBits / 8);
	const mHash = new Uint8Array(await crypto.subtle.digest(HASH, m.slice().buffer));
	if (emLen < H_LEN + SALT_LEN + 2) return false;
	if (em[emLen - 1] !== 0xbc) return false;
	const maskedDB = em.slice(0, emLen - H_LEN - 1);
	const h = em.slice(emLen - H_LEN - 1, emLen - 1);
	const zeroBits = 8 * emLen - emBits;
	const topMask = zeroBits === 0 ? 0 : (0xff << (8 - zeroBits)) & 0xff;
	if ((maskedDB[0] & topMask) !== 0) return false;
	const dbMask = await mgf1(sjcl, i2osp, joinAll, h, emLen - H_LEN - 1);
	const db = new Uint8Array(maskedDB.length);
	for (let i = 0; i < db.length; i++) db[i] = maskedDB[i] ^ dbMask[i];
	db[0] &= 0xff >> zeroBits;
	const psLen = emLen - H_LEN - SALT_LEN - 2;
	for (let i = 0; i < psLen; i++) if (db[i] !== 0x00) return false;
	if (db[psLen] !== 0x01) return false;
	const salt = db.slice(db.length - SALT_LEN);
	const hPrime = new Uint8Array(
		await crypto.subtle.digest(HASH, joinAll([new Uint8Array(8), mHash, salt]).slice().buffer)
	);
	if (h.length !== hPrime.length) return false;
	let diff = 0;
	for (let i = 0; i < h.length; i++) diff |= h[i] ^ hPrime[i];
	return diff === 0;
}

// DerivePublicKey for public metadata (draft-amjad-cfrg-partially-blind-rsa §,
// mirrored from PartiallyBlindRSA.derivePublicKey, partially_blindrsa.js:249-273).
// We inline it rather than call the library method because that method is
// declared `private` in the type surface. The output e' is byte-identical to the
// library's (asserted by the unit test that diffs the whole finalize), so this
// stays wire-compatible.
async function deriveMetadataExponent(
	deps: Awaited<ReturnType<typeof loadFinalizeDeps>>,
	n: ReturnType<Awaited<ReturnType<typeof loadFinalizeDeps>>['os2ip']>,
	info: Uint8Array
) {
	const { sjcl, i2osp, joinAll } = deps;
	const hkdfInput = joinAll([new TextEncoder().encode('key'), info, new Uint8Array([0x00])]);
	const hkdfSalt = i2osp(n, n.bitLength() >> 3);
	const lambdaLen = n.bitLength() >> 4; // modulus_len_bytes / 2
	const hkdfLen = lambdaLen + 16;
	const expanded = new Uint8Array(
		await crypto.subtle.deriveBits(
			{
				name: 'HKDF',
				hash: HASH,
				info: new TextEncoder().encode('PBRSA'),
				salt: hkdfSalt.slice().buffer
			},
			await crypto.subtle.importKey('raw', hkdfInput, 'HKDF', false, ['deriveBits']),
			hkdfLen * 8
		)
	);
	expanded[0] &= 0x3f; // clear two top bits
	expanded[lambdaLen - 1] |= 0x01; // set bottom bit (force odd)
	return sjcl.bn.fromBits(sjcl.codec.bytes.toBits(Array.from(expanded.slice(0, lambdaLen))));
}

// Chromium-safe replacement for suite.finalize(). Mirrors
// PartiallyBlindRSA.finalize (partially_blindrsa.js:138-185) byte-for-byte for
// the signature, swapping only its WebCrypto derived-key self-check for an
// arithmetic EMSA-PSS-VERIFY (see the WHY block above).
async function finalizeInBrowser(
	pub: CryptoKey,
	prepared: Uint8Array,
	info: Uint8Array,
	blindSig: Uint8Array,
	inv: Uint8Array
): Promise<Uint8Array> {
	const deps = await loadFinalizeDeps();
	const { sjcl, os2ip, i2osp, int_to_bytes, rsavp1, joinAll } = deps;

	const jwk = await crypto.subtle.exportKey('jwk', pub);
	if (!jwk.n) throw new Error('public key missing modulus');
	const n = sjcl.bn.fromBits(sjcl.codec.base64url.toBits(jwk.n));
	const kLen = Math.ceil((pub.algorithm as RsaHashedKeyAlgorithm).modulusLength / 8);

	// 0-2: sizes + recover z. (RFC 9474 finalize steps 0-2.)
	if (inv.length !== kLen) throw new Error('unexpected input size');
	if (blindSig.length !== kLen) throw new Error('unexpected input size');
	const rInv = os2ip(inv);
	const z = os2ip(blindSig);

	// 3-4: s = z * rInv mod n ; sig = i2osp(s, kLen). Identical to the library.
	const s = z.mulmod(rInv, n);
	const sig = i2osp(s, kLen);

	// 5: msg_prime = concat("msg", int_to_bytes(len(info),4), info, prepared).
	const msgPrime = joinAll([
		new TextEncoder().encode('msg'),
		int_to_bytes(info.length, 4),
		info,
		prepared
	]);

	// 6-8: derive e' for this metadata, then EMSA-PSS-VERIFY the unblinded sig
	// arithmetically (rsavp1 + EMSA-PSS-VERIFY) — no large-exponent key import.
	const ePrime = await deriveMetadataExponent(deps, n, info);
	const emBits = n.bitLength() - 1; // matches emsa_pss_encode(..., modulusLength-1) in blind()
	const recovered = i2osp(rsavp1({ e: ePrime, n }, os2ip(sig)), Math.ceil(emBits / 8));
	if (!(await emsaPssVerify(deps, msgPrime, recovered, emBits))) {
		throw new Error('invalid signature');
	}
	return sig;
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

	// Use the Chromium-safe finalize (see finalizeInBrowser): the library's own
	// suite.finalize throws OperationError in Chromium because it imports the
	// 1024-bit derived public key into WebCrypto. The result is byte-identical.
	const signature = await finalizeInBrowser(pub, prepared, info, blindSig, inv);
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

// Random redemption jitter (ms). A small client-side delay before the vote POST
// decorrelates the authenticated issuance from the anonymous redemption in time,
// so an operator watching request timestamps cannot trivially pair "user X asked
// for a token at T" with "a vote arrived at ~T". Paired with the server-side
// coarsening of vote_token_issuances.created_at (see recordIssuance), this raises
// the cost of the timing side-channel.
//
// RESIDUAL (documented, not eliminated): in a blog with a single eligible
// reviewer, ANY issuance↔vote pairing is trivial regardless of timing — there is
// only one candidate voter, so the anonymity set is size 1. Jitter only helps
// once the eligible-reviewer set is >1 and several reviewers act in overlapping
// windows; it does not manufacture an anonymity set that the population denies.
// The jitter is also bounded (a few seconds) to stay within the redemption
// rate-limit window and keep the UI responsive, so a patient operator correlating
// over a long quiet period still gains some signal. This is a mitigation, not a
// guarantee.
const REDEEM_JITTER_MAX_MS = 4000;
const REDEEM_JITTER_MIN_MS = 250;

function redeemJitterMs(): number {
	const span = REDEEM_JITTER_MAX_MS - REDEEM_JITTER_MIN_MS;
	const r = crypto.getRandomValues(new Uint32Array(1))[0] / 0x1_0000_0000;
	return REDEEM_JITTER_MIN_MS + Math.floor(r * span);
}

// Step 2 — anonymous redemption (the vote). Session-free: credentials omitted.
export async function castVote(opts: {
	versionId: string;
	token: RedeemableToken;
	vote: 'approve' | 'reject';
	comment?: string;
	rejectionReasons?: string[];
}): Promise<Response> {
	// Decorrelate redemption from issuance in time (see REDEEM_JITTER_MAX_MS).
	await new Promise((resolve) => setTimeout(resolve, redeemJitterMs()));
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

// Test-only surface. finalizeInBrowser is internal to requestAndBuildToken; we
// expose it here so the unit test can prove it is byte-compatible with the
// library's finalize without going through fetch. Not part of the public API.
export const __testing = { finalizeInBrowser };
