import { createMinisterClient, generatePkce, randomUrlToken } from '@minister/client';
import type { MinisterClient, MinisterClaims, OidcFlowState } from '@minister/client';
import { decodeJwt } from 'jose';
import { env } from '$env/dynamic/private';

// "Sign in with Minister" — Minister is an external OpenID Connect identity
// provider. We are the relying party: authorization-code flow with PKCE
// (S256). The OIDC mechanics (discovery, PKCE, authorization-URL building,
// token exchange, id_token verification) are delegated to `@minister/client`;
// this module keeps only FreedInk's config and glue. Configuration comes from
// env (all four required to enable it):
//   OIDC_MINISTER_ISSUER         e.g. http://localhost:3000
//   OIDC_MINISTER_CLIENT_ID
//   OIDC_MINISTER_CLIENT_SECRET
//   OIDC_MINISTER_REDIRECT_URI   e.g. http://localhost:5173/api/auth/oidc/callback

// Scopes FreedInk requests. Identity only — no badge scopes are disclosed.
const SCOPES = ['openid', 'profile'];

export interface OidcConfig {
	issuer: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
}

export function oidcConfig(): OidcConfig | null {
	const issuer = env.OIDC_MINISTER_ISSUER;
	const clientId = env.OIDC_MINISTER_CLIENT_ID;
	const clientSecret = env.OIDC_MINISTER_CLIENT_SECRET;
	const redirectUri = env.OIDC_MINISTER_REDIRECT_URI;
	if (!issuer || !clientId || !clientSecret || !redirectUri) return null;
	return { issuer: issuer.replace(/\/$/, ''), clientId, clientSecret, redirectUri };
}

export function oidcEnabled(): boolean {
	return oidcConfig() !== null;
}

// Cookie that carries an optional post-login destination across the OIDC
// round-trip (e.g. an invitation link). Set by `start`, consumed by `callback`.
export const NEXT_COOKIE = 'oidc_next';

// A post-login destination is safe only if it's a same-origin absolute path
// (`/foo`). Reject protocol-relative (`//evil`) and backslash tricks so this
// can't be turned into an open redirect. Strip any URL fragment (`#...`): the
// callback emits `next` verbatim as a `Location`, and a crafted fragment would
// override the anonymous-identity fragment the app relies on. Shared by start
// (on write) and callback (re-validated on read).
export function safeNext(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
	const hash = raw.indexOf('#');
	return hash === -1 ? raw : raw.slice(0, hash);
}

// Build a Minister relying-party client from FreedInk's config. The SDK is
// stateless, so a fresh client per request is cheap (discovery + JWKS are
// cached inside the SDK per issuer for the process lifetime).
function client(cfg: OidcConfig): MinisterClient {
	return createMinisterClient({
		issuer: cfg.issuer,
		clientId: cfg.clientId,
		clientSecret: cfg.clientSecret,
		redirectUri: cfg.redirectUri
	});
}

// Start a flow: PKCE (async — Web Crypto), state, and nonce, plus the
// authorization URL to redirect to. The returned `flow` is the per-request
// state the caller MUST persist (in `oidc_sessions`) and consume atomically by
// `state` in the callback.
export async function beginAuthorization(
	cfg: OidcConfig
): Promise<{ url: string; flow: OidcFlowState }> {
	const { verifier, challenge } = await generatePkce();
	const state = randomUrlToken();
	const nonce = randomUrlToken();

	const url = await client(cfg).getAuthorizationUrl({
		scopes: SCOPES,
		state,
		nonce,
		codeChallenge: challenge
	});

	return {
		url,
		flow: {
			state,
			nonce,
			codeVerifier: verifier,
			// Persisted as a Date by Drizzle; the SDK's epoch-ms field is unused
			// here because `oidc_sessions` enforces expiry in SQL.
			expiresAt: Date.now() + 10 * 60 * 1000
		}
	};
}

// Exchange the authorization code for tokens, verify the id_token (signature
// via JWKS, iss/aud/nonce), and return the identity claims. Throws on any
// failure — the caller maps that to a 401. FreedInk requests no badge scopes,
// so the SDK's verified-badge list is empty and intentionally ignored here.
export async function exchangeCodeForClaims(
	cfg: OidcConfig,
	args: { code: string; codeVerifier: string; expectedNonce: string }
): Promise<MinisterClaims> {
	const { claims } = await client(cfg).exchangeCode({
		code: args.code,
		codeVerifier: args.codeVerifier,
		expectedNonce: args.expectedNonce
	});
	return claims;
}

// The Ministry anonymous-identity epoch carried by the VERIFIED id_token
// (`minister_anon_epoch`). `claims.raw` is the raw id_token the SDK has already
// signature/iss/aud/nonce-verified, so decoding its payload here is reading an
// authenticated value — never trust an id_token this hasn't seen verified. The
// epoch is a positive integer that only advances (Ministry bumps it on a root
// re-key); anything else (absent, non-integer, < 1) yields null and the user's
// stored epoch is left unchanged.
export function extractAnonEpoch(claims: MinisterClaims): number | null {
	try {
		const payload = decodeJwt(claims.raw);
		const epoch = payload['minister_anon_epoch'];
		if (typeof epoch === 'number' && Number.isInteger(epoch) && epoch >= 1) return epoch;
		return null;
	} catch {
		return null;
	}
}

// Stable key stored alongside the pairwise subject. Minister's `sub` is unique
// only per (issuer, client), so we pair it with the issuer — a future second
// OIDC provider then can't collide with Minister's subject space.
export function issuerKey(cfg: OidcConfig): string {
	return cfg.issuer;
}
