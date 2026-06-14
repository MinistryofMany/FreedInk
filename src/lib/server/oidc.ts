import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '$env/dynamic/private';

// "Sign in with Minister" — Minister is an external OpenID Connect identity
// provider. We are the relying party: authorization-code flow with PKCE
// (S256). Configuration comes from env (all four required to enable it):
//   OIDC_MINISTER_ISSUER         e.g. http://localhost:3000
//   OIDC_MINISTER_CLIENT_ID
//   OIDC_MINISTER_CLIENT_SECRET
//   OIDC_MINISTER_REDIRECT_URI   e.g. http://localhost:5173/api/auth/oidc/callback

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
// can't be turned into an open redirect. Shared by start (on write) and
// callback (re-validated on read).
export function safeNext(raw: string | null | undefined): string | null {
	if (!raw) return null;
	if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null;
	return raw;
}

interface Discovery {
	issuer: string;
	authorization_endpoint: string;
	token_endpoint: string;
	jwks_uri: string;
}

// Cache discovery doc + JWKS per issuer for the process lifetime. The JWKS
// set fetches lazily and rotates keys on its own.
const discoveryCache = new Map<string, Promise<Discovery>>();
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function discover(cfg: OidcConfig): Promise<Discovery> {
	let p = discoveryCache.get(cfg.issuer);
	if (!p) {
		p = fetch(`${cfg.issuer}/.well-known/openid-configuration`).then(async (res) => {
			if (!res.ok) throw new Error(`OIDC discovery failed: HTTP ${res.status}`);
			return (await res.json()) as Discovery;
		});
		discoveryCache.set(cfg.issuer, p);
	}
	return p;
}

function jwksFor(cfg: OidcConfig, jwksUri: string) {
	let set = jwksCache.get(cfg.issuer);
	if (!set) {
		set = createRemoteJWKSet(new URL(jwksUri));
		jwksCache.set(cfg.issuer, set);
	}
	return set;
}

function b64url(buf: Buffer): string {
	return buf.toString('base64url');
}

export function generatePkce(): { verifier: string; challenge: string } {
	const verifier = b64url(randomBytes(32));
	const challenge = b64url(createHash('sha256').update(verifier).digest());
	return { verifier, challenge };
}

export function randomUrlToken(bytes = 16): string {
	return b64url(randomBytes(bytes));
}

export async function buildAuthorizationUrl(
	cfg: OidcConfig,
	args: { state: string; nonce: string; codeChallenge: string }
): Promise<string> {
	const d = await discover(cfg);
	const u = new URL(d.authorization_endpoint);
	u.searchParams.set('response_type', 'code');
	u.searchParams.set('client_id', cfg.clientId);
	u.searchParams.set('redirect_uri', cfg.redirectUri);
	u.searchParams.set('scope', 'openid profile');
	u.searchParams.set('state', args.state);
	u.searchParams.set('nonce', args.nonce);
	u.searchParams.set('code_challenge', args.codeChallenge);
	u.searchParams.set('code_challenge_method', 'S256');
	return u.toString();
}

export interface MinisterClaims {
	sub: string;
	name?: string;
	picture?: string;
}

// Exchange the authorization code for tokens, verify the id_token's signature
// against Minister's JWKS, and check iss / aud / nonce. Returns the identity
// claims. Throws on any failure — the caller maps that to a 401.
export async function exchangeCodeForClaims(
	cfg: OidcConfig,
	args: { code: string; codeVerifier: string; expectedNonce: string }
): Promise<MinisterClaims> {
	const d = await discover(cfg);
	const res = await fetch(d.token_endpoint, {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			grant_type: 'authorization_code',
			code: args.code,
			redirect_uri: cfg.redirectUri,
			client_id: cfg.clientId,
			client_secret: cfg.clientSecret,
			code_verifier: args.codeVerifier
		})
	});
	if (!res.ok) {
		const detail = await res.text().catch(() => '');
		throw new Error(`token exchange failed: HTTP ${res.status} ${detail}`);
	}
	const tokens = (await res.json()) as { id_token?: string };
	if (!tokens.id_token) throw new Error('token response missing id_token');

	const { payload } = await jwtVerify(tokens.id_token, jwksFor(cfg, d.jwks_uri), {
		issuer: d.issuer,
		audience: cfg.clientId,
		algorithms: ['EdDSA']
	});
	if (payload.nonce !== args.expectedNonce) throw new Error('id_token nonce mismatch');
	if (typeof payload.sub !== 'string' || !payload.sub) throw new Error('id_token missing sub');

	return {
		sub: payload.sub,
		name: typeof payload.name === 'string' ? payload.name : undefined,
		picture: typeof payload.picture === 'string' ? payload.picture : undefined
	};
}

// Stable key stored alongside the pairwise subject. Minister's `sub` is unique
// only per (issuer, client), so we pair it with the issuer — a future second
// OIDC provider then can't collide with Minister's subject space.
export function issuerKey(cfg: OidcConfig): string {
	return cfg.issuer;
}
