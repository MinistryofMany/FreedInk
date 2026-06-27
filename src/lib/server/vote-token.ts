// Blind-signature voting tokens (Privacy Pass-style), server side.
//
// Scheme: partially-blind RSA signatures with PUBLIC METADATA (RFC 9474 + the
// public-metadata extension / draft-amjad-cfrg-partially-blind-rsa), via the
// vetted @cloudflare/blindrsa-ts library. We do NOT hand-roll any blinding.
//
// Why public metadata: the metadata is the `version_id`. The library derives a
// per-metadata key pair from the issuer key, so a signature for version V only
// verifies under version V — a token cannot be replayed against a different
// version (no cross-version replay).
//
// Roles in the FreedInk vote flow:
//   - Issuance (authenticated, can_review-gated): the client blinds a random
//     nonce and asks for a signature; the server blind-signs over (version_id,
//     blinded nonce) and records that THIS user got a token for THIS version
//     (one per (user, version)). This is the only step that reveals
//     participation — the server learns "user asked for a token", never the vote.
//   - Redemption (anonymous, session-free): the client submits the unblinded
//     signature + the cleartext nonce + the vote; the server verifies the
//     signature over (version_id, nonce) and records the vote keyed by the nonce.
//     Issuance and redemption are UNLINKABLE under the blind signature.
//
// IMPORTANT (validated empirically): the variant factories' generateKey wrapper
// silently drops a custom safe-prime callback and falls back to a multi-minute
// pure-JS sjcl keygen. We therefore call the STATIC PartiallyBlindRSA.generateKey
// with a fast Node-native safe-prime generator (generatePrimeSync(safe:true)),
// which produces a 2048-bit key in ~1s.

import { RSAPBSSA, PartiallyBlindRSA } from '@cloudflare/blindrsa-ts';
import { generatePrimeSync, webcrypto } from 'node:crypto';

// The suite: RSAPBSSA, SHA-384, PSS, Randomized (matches the library's primary
// partially-blind variant and the draft test vectors). Both sides MUST use the
// same suite + the same `info` (version_id) byte string.
const SUITE = RSAPBSSA.SHA384.PSS.Randomized();

const MODULUS_LENGTH = 2048;
const PUBLIC_EXPONENT = Uint8Array.from([1, 0, 1]); // 65537

// subtle handle (Node's webcrypto) for importing/exporting CryptoKeys.
const subtle = webcrypto.subtle;

// Fast safe-prime generator. The partially-blind scheme requires SAFE primes
// (p and (p-1)/2 both prime); Node's generatePrimeSync({safe:true}) returns one
// quickly, unlike the library's default pure-JS sjcl generator.
function fastSafePrime(length: number): bigint {
	return generatePrimeSync(length, { safe: true, bigint: true });
}

export type VoteTokenKeyPair = {
	// SPKI-encoded RSA-PSS public key (DER bytes). Stored + used to verify.
	publicKeySpki: Uint8Array;
	// PKCS8-encoded private key (DER bytes). Stored encrypted-at-rest at the DB
	// layer is out of scope here; it is operator-held signing material.
	privateKeyPkcs8: Uint8Array;
};

// Generate a fresh per-blog (or per-round) issuer key pair. ~1s for 2048-bit
// with the native safe-prime generator. Call once per blog at first use and
// cache the result in the DB.
export async function generateVoteTokenKey(): Promise<VoteTokenKeyPair> {
	const { privateKey, publicKey } = await PartiallyBlindRSA.generateKey(
		{ modulusLength: MODULUS_LENGTH, publicExponent: PUBLIC_EXPONENT, hash: 'SHA-384' },
		fastSafePrime
	);
	const [spki, pkcs8] = await Promise.all([
		subtle.exportKey('spki', publicKey),
		subtle.exportKey('pkcs8', privateKey)
	]);
	return {
		publicKeySpki: new Uint8Array(spki),
		privateKeyPkcs8: new Uint8Array(pkcs8)
	};
}

// The library's signatures use the lib.dom `CryptoKey`; Node's webcrypto returns
// `node:crypto` CryptoKey, which is structurally identical at runtime but a
// distinct nominal type. Cast through unknown at the boundary.
async function importPublicKey(spki: Uint8Array): Promise<CryptoKey> {
	const key = await subtle.importKey(
		'spki',
		spki as unknown as ArrayBuffer,
		{ name: 'RSA-PSS', hash: 'SHA-384' },
		true,
		['verify']
	);
	return key as unknown as CryptoKey;
}

async function importPrivateKey(pkcs8: Uint8Array): Promise<CryptoKey> {
	const key = await subtle.importKey(
		'pkcs8',
		pkcs8 as unknown as ArrayBuffer,
		{ name: 'RSA-PSS', hash: 'SHA-384' },
		true,
		['sign']
	);
	return key as unknown as CryptoKey;
}

// The public metadata (`info`) for a version. Binding the token to this string
// is what prevents cross-version replay. We use the raw version_id UTF-8 bytes.
export function versionInfo(versionId: string): Uint8Array {
	return new TextEncoder().encode(`freedink-vote:${versionId}`);
}

// SERVER (issuance): blind-sign a client's blinded message under the version's
// metadata. The server never sees the unblinded nonce.
export async function blindSignVoteToken(opts: {
	privateKeyPkcs8: Uint8Array;
	blindedMessage: Uint8Array;
	versionId: string;
}): Promise<Uint8Array> {
	const sk = await importPrivateKey(opts.privateKeyPkcs8);
	return SUITE.blindSign(sk, opts.blindedMessage, versionInfo(opts.versionId));
}

// SERVER (redemption): verify an unblinded signature over (version metadata,
// prepared nonce). Returns true iff the signature was produced by THIS issuer
// key for THIS exact version and nonce. The nonce passed here MUST be the
// library-`prepare`d message bytes the client signed (see prepareNonce note).
export async function verifyVoteToken(opts: {
	publicKeySpki: Uint8Array;
	signature: Uint8Array;
	preparedNonce: Uint8Array;
	versionId: string;
}): Promise<boolean> {
	let pk: CryptoKey;
	try {
		pk = await importPublicKey(opts.publicKeySpki);
	} catch {
		return false;
	}
	try {
		return await SUITE.verify(pk, opts.signature, opts.preparedNonce, versionInfo(opts.versionId));
	} catch {
		// A malformed signature/nonce throws inside the library; treat as invalid.
		return false;
	}
}
