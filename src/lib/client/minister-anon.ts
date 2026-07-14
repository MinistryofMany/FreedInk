import { browser } from '$app/environment';
import {
	extractMinisterAppSecret,
	deriveDeviceSeedFromMinister,
	RP_MIX_SECRET_MIN_BYTES
} from '@ministryofmany/identity';

// Ministry → FreedInk anonymous-identity handoff (anon-identity master spec
// §8.4 / §9). When FreedInk's OIDC client is anon-enabled on Minister
// (OidcClient.anonAppId set), the consent page appends a per-app secret to the
// callback redirect as a URL fragment (`#minister_anon=v1.…`). The fragment
// survives the server-side 3xx hops (callback → /signup/identity) because
// browsers re-attach the original fragment across redirects, and it never
// reaches any server — fragments aren't sent in HTTP requests.
//
// Two-phase client-side consumption:
//
//   1. `captureMinisterAppSecret()` — hooks.client.ts calls this FIRST at
//      client boot, before Sentry loads and before any router navigation can
//      read or destroy the fragment (spec findings S3/S4). It reads the
//      per-app secret into module memory and scrubs it from the URL/history.
//   2. `ministerIdentitySeed(mixSecret)` — the signup identity page calls this
//      when creating the Semaphore identity. It mixes the operator-provisioned
//      RP secret (MINISTER_ANON_RP_MIX_SECRET, delivered via that page's
//      server load) into the per-app secret with HKDF and returns the 32-byte
//      seed that deterministically becomes the identity.
//
// Everything here is browser-local. Neither the per-app secret nor the derived
// seed may EVER be sent to the FreedInk server (spec §9.3) — the server keeps
// seeing exactly what it sees today: an encrypted vault blob and a commitment.
//
// Fail-closed by design: on any missing/malformed input the seed is null and
// the caller falls back to today's locally generated random identity. Login is
// never blocked by this path.

let appSecret: Uint8Array | null = null;
let derivedSeed: Uint8Array | null = null;
let captured = false;

// Read + scrub the `minister_anon` fragment. Idempotent per document load;
// hooks.client.ts calls it before anything else touches the URL. A fragment
// only arrives on a full-document navigation (the OIDC callback redirect
// chain), which always re-evaluates this module, so once per load is correct.
export function captureMinisterAppSecret(): void {
	if (!browser || captured) return;
	captured = true;
	try {
		appSecret = extractMinisterAppSecret();
	} catch (err) {
		// extract throws only when it cannot scrub (history.replaceState
		// missing). Breaking client boot would break every login, so fail
		// closed on the anon identity instead and keep the app alive.
		appSecret = null;
		console.warn('minister anon fragment could not be captured', err);
	}
}

// Strict base64url decoder for the operator-provisioned mix secret. Tolerates
// trailing '=' padding; rejects any other non-base64url character rather than
// silently decoding garbage.
function decodeBase64url(s: string): Uint8Array | null {
	const stripped = s.replace(/=+$/, '');
	if (!/^[A-Za-z0-9_-]+$/.test(stripped)) return null;
	const b64 = stripped.replace(/-/g, '+').replace(/_/g, '/');
	const pad = '='.repeat((4 - (b64.length % 4)) % 4);
	let bin: string;
	try {
		bin = atob(b64 + pad);
	} catch {
		return null;
	}
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

// Derive (once) the 32-byte identity seed from the captured per-app secret and
// the RP mix secret (base64url string from MINISTER_ANON_RP_MIX_SECRET, handed
// to the page by its server load). Returns null — preserving today's random
// generation — when:
//   - no fragment arrived (not anon-enabled, user declined/couldn't unlock), or
//   - the fragment arrived but the mix secret is unset, malformed, or shorter
//     than 32 bytes (fail closed: never derive from a weak or missing mix).
//
// The result is memoized for the page's lifetime so a retried form submit
// (e.g. after a transient server error) re-uses the SAME seed instead of
// silently falling back to a random identity. The raw per-app secret is
// zeroed as soon as the seed exists; caching the mixed seed — never the raw
// secret — is exactly the posture spec §9.3 requires, and the seed is the same
// material the vault later caches in sessionStorage as the unlocked identity.
export async function ministerIdentitySeed(
	mixSecretB64url: string | null | undefined
): Promise<Uint8Array | null> {
	if (derivedSeed) return derivedSeed;
	const secret = appSecret;
	if (!secret) return null;
	if (!mixSecretB64url) {
		console.warn(
			'minister anon fragment present but MINISTER_ANON_RP_MIX_SECRET is not provisioned; using a locally generated identity'
		);
		dropAppSecret();
		return null;
	}
	const mix = decodeBase64url(mixSecretB64url);
	if (!mix || mix.byteLength < RP_MIX_SECRET_MIN_BYTES) {
		console.warn(
			'MINISTER_ANON_RP_MIX_SECRET is malformed or shorter than 32 bytes; using a locally generated identity'
		);
		dropAppSecret();
		return null;
	}
	try {
		derivedSeed = await deriveDeviceSeedFromMinister(secret, mix);
	} catch (err) {
		// Real-world case: WebCrypto unavailable (non-secure context). Fail
		// closed to a random identity; the vault would fail without WebCrypto
		// anyway, but never let this path be the thing that blocks signup.
		console.warn('minister anon seed derivation failed; using a locally generated identity', err);
		return null;
	}
	dropAppSecret();
	return derivedSeed;
}

// The mix-secret dead ends are deterministic for the rest of the page's life
// (the env value can't change under a running session), so once the seed
// exists — or can never exist — the raw per-app secret has no further use and
// is zeroed rather than left sitting in module memory.
function dropAppSecret(): void {
	appSecret?.fill(0);
	appSecret = null;
}
