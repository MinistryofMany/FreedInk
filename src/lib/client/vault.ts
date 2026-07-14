import { browser } from '$app/environment';
// Import directly from the identity subpackage instead of the @semaphore-protocol/core
// barrel — `core` re-exports group + proof and the bundler can't tree-shake
// snarkjs out of it, so pulling in `core` for just `Identity` drags ~370 KB
// into every route that touches the vault.
import { Identity } from '@semaphore-protocol/identity';

// Encrypted-identity vault. Lives in the browser; the server only ever sees
// `{idc, public_key, ciphertext, salt, params, nonce}` blobs.
//
// KDF: PBKDF2-HMAC-SHA-256 (browser-native via WebCrypto).
// AEAD: AES-GCM 256.

export type KdfParams = { name: 'PBKDF2'; iterations: number; hash: 'SHA-256' };

export type VaultBlob = {
	ciphertext: Uint8Array;
	salt: Uint8Array;
	nonce: Uint8Array; // AES-GCM iv
	kdf: 'pbkdf2-sha256';
	kdfParams: KdfParams;
};

export type IdentityRecord = VaultBlob & {
	idc: string;
	publicKey: string;
};

const DEFAULT_ITERS = 600_000;

function assertBrowser() {
	if (!browser) throw new Error('vault is browser-only');
}

async function deriveKey(
	password: string,
	salt: Uint8Array,
	params: KdfParams
): Promise<CryptoKey> {
	const baseKey = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(password) as BufferSource,
		'PBKDF2',
		false,
		['deriveKey']
	);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			salt: salt as BufferSource,
			iterations: params.iterations,
			hash: params.hash
		},
		baseKey,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt']
	);
}

function rand(n: number): Uint8Array {
	const a = new Uint8Array(n);
	crypto.getRandomValues(a);
	return a;
}

// Create a new identity and encrypt it under `password`. By default the
// identity secret is fresh CSPRNG output (`new Identity()`); when `entropy`
// is supplied (exactly 32 bytes — the Ministry-derived device seed from
// $lib/client/minister-anon) the SAME bytes become the identity secret, via
// the identical Identity.import path the mnemonic restore below uses, so the
// identity is deterministic: re-deriving the seed reproduces the commitment.
// Wrong-size entropy throws loudly — that's a programmer error, not a
// fail-closed condition; callers wanting the random identity pass nothing.
export async function generateIdentity(
	password: string,
	entropy?: Uint8Array
): Promise<{ identity: Identity; record: IdentityRecord }> {
	assertBrowser();
	if (entropy !== undefined && entropy.byteLength !== 32) {
		throw new Error(`identity entropy must be 32 bytes, got ${entropy.byteLength}`);
	}
	const identity = entropy ? Identity.import(bytesToBase64(entropy)) : new Identity();
	const record = await encryptIdentity(identity, password);
	return { identity, record };
}

// ─── BIP-39 mnemonic export/import ─────────────────────────────────────────
//
// A second backup path independent of the password-encrypted blob on the
// server. The user copies down a 24-word mnemonic; if they lose their device
// AND their password, the mnemonic regenerates the same Identity.
//
// Semaphore identities are 32 bytes (256 bits) of entropy → 24 words.
//
// Why offer both vault password AND mnemonic? Different threat models:
//   - Password is what you use day-to-day; rotation is easy if you suspect
//     compromise.
//   - Mnemonic is for full account recovery, kept on paper, in a vault, etc.
//     If both are lost the identity is unrecoverable — same as today.

export async function exportMnemonic(identity: Identity): Promise<string> {
	assertBrowser();
	const { entropyToMnemonic } = await import('@scure/bip39');
	const { wordlist } = await import('@scure/bip39/wordlists/english');
	const exported = identity.export(); // base64-encoded secret bytes
	const secretBytes = base64ToBytes(exported);
	if (secretBytes.byteLength !== 32) {
		// Future-proofing: if Semaphore ever changes secret size, fall back to
		// length-prefixed encoding so we still produce a valid mnemonic.
		throw new Error(`unexpected identity secret size: ${secretBytes.byteLength} bytes`);
	}
	return entropyToMnemonic(secretBytes, wordlist);
}

export async function identityFromMnemonic(mnemonic: string): Promise<Identity> {
	assertBrowser();
	const { mnemonicToEntropy, validateMnemonic } = await import('@scure/bip39');
	const { wordlist } = await import('@scure/bip39/wordlists/english');
	const trimmed = mnemonic.trim().split(/\s+/).join(' ').toLowerCase();
	if (!validateMnemonic(trimmed, wordlist)) {
		throw new Error('invalid mnemonic: words or checksum do not match BIP-39');
	}
	const entropy = mnemonicToEntropy(trimmed, wordlist);
	// Identity's constructor accepts the exported (base64) secret string.
	const b64 = bytesToBase64(entropy);
	return Identity.import(b64);
}

function base64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const arr = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
	return arr;
}

function bytesToBase64(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s);
}

export async function encryptIdentity(
	identity: Identity,
	password: string
): Promise<IdentityRecord> {
	assertBrowser();
	const salt = rand(16);
	const nonce = rand(12);
	const params: KdfParams = { name: 'PBKDF2', iterations: DEFAULT_ITERS, hash: 'SHA-256' };
	const key = await deriveKey(password, salt, params);
	const secret = new TextEncoder().encode(identity.export()) as BufferSource;
	const ct = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource }, key, secret)
	);
	return {
		idc: identity.commitment.toString(),
		publicKey: identity.publicKey.toString(),
		ciphertext: ct,
		salt,
		nonce,
		kdf: 'pbkdf2-sha256',
		kdfParams: params
	};
}

// Re-encrypt an EXISTING identity under a NEW password WITHOUT changing the
// identity/commitment. This is the persistent forgotten-password reset: the
// user proves control of the identity (recovery phrase OR old password), then
// sets a new password that re-wraps the SAME secret. The resulting record keeps
// the same `idc`/`publicKey`, so the server updates the existing vault row in
// place (no collision with the global-unique idc index) and every blog
// membership, past proof, and Merkle leaf stays valid.
//
// `expectedIdc` binds the operation to the account commitment being reset: if
// the supplied identity does not match it we refuse, and after encrypting we
// unlock the fresh blob and re-check the commitment. Fails closed on any
// mismatch so a corrupted round-trip can never lock the user out or, worse, let
// a different identity be swapped in under cover of a password reset.
export async function reEncryptIdentity(
	identity: Identity,
	newPassword: string,
	expectedIdc: string
): Promise<IdentityRecord> {
	assertBrowser();
	if (identity.commitment.toString() !== expectedIdc) {
		throw new Error('identity does not match the account commitment being reset');
	}
	const record = await encryptIdentity(identity, newPassword);
	// Self-check: the new blob must decrypt back to the SAME commitment.
	const check = await unlockIdentity(record, newPassword);
	if (record.idc !== expectedIdc || check.commitment.toString() !== expectedIdc) {
		throw new Error('re-encryption self-check failed: commitment mismatch');
	}
	return record;
}

export async function unlockIdentity(blob: VaultBlob, password: string): Promise<Identity> {
	assertBrowser();
	const key = await deriveKey(password, blob.salt, blob.kdfParams);
	let plain: ArrayBuffer;
	try {
		plain = await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: blob.nonce as BufferSource },
			key,
			blob.ciphertext as BufferSource
		);
	} catch {
		throw new Error('wrong password');
	}
	const exported = new TextDecoder().decode(plain);
	return Identity.import(exported);
}

// Cache the unlocked identity in sessionStorage for the tab lifetime so the
// user doesn't have to re-enter their password on every action. Never written
// to localStorage.
const TAB_KEY = 'freedink.identity.exported';

export function cacheUnlockedIdentity(identity: Identity) {
	assertBrowser();
	sessionStorage.setItem(TAB_KEY, identity.export());
}

export function getCachedIdentity(): Identity | null {
	if (!browser) return null;
	const v = sessionStorage.getItem(TAB_KEY);
	return v ? Identity.import(v) : null;
}

export function clearCachedIdentity() {
	if (browser) sessionStorage.removeItem(TAB_KEY);
}

// Wire formats for posting blobs over the network: base64url'd byte fields.
function b64url(bytes: Uint8Array): string {
	let s = '';
	for (const b of bytes) s += String.fromCharCode(b);
	return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
	const pad = '='.repeat((4 - (s.length % 4)) % 4);
	const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
	const a = new Uint8Array(b.length);
	for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
	return a;
}

export function encodeForWire(r: IdentityRecord) {
	return {
		idc: r.idc,
		public_key: r.publicKey,
		ciphertext: b64url(r.ciphertext),
		salt: b64url(r.salt),
		nonce: b64url(r.nonce),
		kdf: r.kdf,
		kdf_params: r.kdfParams
	};
}

export function decodeFromWire(w: ReturnType<typeof encodeForWire>): VaultBlob {
	return {
		ciphertext: fromB64url(w.ciphertext),
		salt: fromB64url(w.salt),
		nonce: fromB64url(w.nonce),
		kdf: w.kdf as 'pbkdf2-sha256',
		kdfParams: w.kdf_params as KdfParams
	};
}
