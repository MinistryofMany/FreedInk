import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '$lib/db/client';
import { enforce, RULES } from '$lib/server/rate-limit';
import {
	oidcConfig,
	exchangeCodeForClaims,
	extractAnonEpoch,
	issuerKey,
	safeNext,
	NEXT_COOKIE
} from '$lib/server/oidc';
import {
	getUserByOidcIdentity,
	createUserWithOidcIdentity,
	linkOidcIdentityToUser,
	setUserAnonEpoch
} from '$lib/db/oidc';
import { createSession, setSessionCookie, SuspendedUserError } from '$lib/server/session';
import { audit } from '$lib/server/audit';

// Minister redirects the browser here with ?code & ?state (or ?error). We
// exchange the code, verify the id_token, then either link the identity to
// the signed-in user or create a fresh FreedInk account, and issue a session.
export const GET: RequestHandler = async (event) => {
	await enforce(RULES.authFinish, event, { keyBy: 'ip' });
	const { url, cookies, locals, request, getClientAddress } = event;

	const cfg = oidcConfig();
	if (!cfg) throw error(503, 'Minister sign-in is not configured');

	// The IdP can decline (user hit "Deny", invalid request, …).
	const idpError = url.searchParams.get('error');
	if (idpError) throw redirect(303, `/signup?oidc_error=${encodeURIComponent(idpError)}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) throw error(400, 'missing code or state');

	// Atomically resolve-and-consume the pending authorization by state. A
	// single DELETE ... RETURNING (gated on not-yet-expired) is the consume:
	// at most one concurrent request can win the row, so a replayed `state`
	// (double-submit, attacker race) finds nothing and is rejected. Splitting
	// this into SELECT-then-DELETE left a TOCTOU window where two requests
	// could both read the row before either deleted it.
	const [pending] = await db
		.delete(schema.oidcSessions)
		.where(and(eq(schema.oidcSessions.state, state), gt(schema.oidcSessions.expiresAt, new Date())))
		.returning();
	if (!pending) throw error(400, 'invalid or expired sign-in state');

	let claims;
	try {
		claims = await exchangeCodeForClaims(cfg, {
			code,
			codeVerifier: pending.codeVerifier,
			expectedNonce: pending.nonce
		});
	} catch {
		// Don't leak the underlying reason (bad code, sig mismatch, …) to the
		// browser; SvelteKit logs the thrown error server-side.
		throw error(401, 'Minister sign-in failed');
	}

	const iss = issuerKey(cfg);
	let user = await getUserByOidcIdentity(iss, claims.sub);
	let newUser = false;
	let linked = false;
	if (!user) {
		if (locals.user) {
			// Already signed in (e.g. via passkey): attach Minister as an
			// additional identity on the existing account.
			await linkOidcIdentityToUser(locals.user.id, iss, claims.sub);
			user = locals.user;
			linked = true;
		} else {
			user = await createUserWithOidcIdentity(iss, claims.sub, { displayName: claims.name });
			newUser = true;
		}
	}

	// Snapshot the verified anon epoch on every Ministry login (advancing only). It
	// is the authority the per-blog leaf-replacement gate reads (C1), and exposing
	// it to the client (root layout → reconcileBranch) is what drives adopt/re-key.
	const anonEpoch = extractAnonEpoch(claims);
	if (anonEpoch !== null) await setUserAnonEpoch(user.id, anonEpoch);

	let sessionId: string;
	try {
		sessionId = await createSession(user.id, {
			userAgent: request.headers.get('user-agent'),
			ip: getClientAddress()
		});
	} catch (e) {
		if (e instanceof SuspendedUserError) {
			throw redirect(303, '/signup?oidc_error=suspended');
		}
		throw e;
	}
	setSessionCookie(cookies, sessionId);

	await audit(event, {
		event: 'session.created',
		actorUserId: user.id,
		subjectUserId: user.id,
		metadata: { method: 'oidc', issuer: iss, new_user: newUser, linked }
	});

	// Honor an optional post-login destination (e.g. an invitation link) that
	// `start` stashed before the round-trip. Consumed once.
	const next = safeNext(cookies.get(NEXT_COOKIE));
	if (next) cookies.delete(NEXT_COOKIE, { path: '/' });

	// No identity-setup step any more: a user's per-blog Semaphore identity is
	// derived from their Ministry branch on demand, the first time they act in a
	// blog (see blog-identity.ts). New accounts go straight where they intended.
	throw redirect(303, next ?? '/admin');
};
