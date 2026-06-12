import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { and, eq, gt } from 'drizzle-orm';
import { db, schema } from '$lib/db/client';
import { enforce, RULES } from '$lib/server/rate-limit';
import { oidcConfig, exchangeCodeForClaims, issuerKey } from '$lib/server/oidc';
import {
	getUserByOidcIdentity,
	createUserWithOidcIdentity,
	linkOidcIdentityToUser
} from '$lib/db/oidc';
import { createSession, setSessionCookie, SuspendedUserError } from '$lib/server/session';
import { audit } from '$lib/server/audit';

// Tessera redirects the browser here with ?code & ?state (or ?error). We
// exchange the code, verify the id_token, then either link the identity to
// the signed-in user or create a fresh FreedInk account, and issue a session.
export const GET: RequestHandler = async (event) => {
	await enforce(RULES.authFinish, event, { keyBy: 'ip' });
	const { url, cookies, locals, request, getClientAddress } = event;

	const cfg = oidcConfig();
	if (!cfg) throw error(503, 'Tessera sign-in is not configured');

	// The IdP can decline (user hit "Deny", invalid request, …).
	const idpError = url.searchParams.get('error');
	if (idpError) throw redirect(303, `/signup?oidc_error=${encodeURIComponent(idpError)}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');
	if (!code || !state) throw error(400, 'missing code or state');

	// Resolve and consume the pending authorization by state (single-use).
	const [pending] = await db
		.select()
		.from(schema.oidcSessions)
		.where(
			and(eq(schema.oidcSessions.state, state), gt(schema.oidcSessions.expiresAt, new Date()))
		)
		.limit(1);
	if (!pending) throw error(400, 'invalid or expired sign-in state');
	await db.delete(schema.oidcSessions).where(eq(schema.oidcSessions.state, state));

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
		throw error(401, 'Tessera sign-in failed');
	}

	const iss = issuerKey(cfg);
	let user = await getUserByOidcIdentity(iss, claims.sub);
	let newUser = false;
	let linked = false;
	if (!user) {
		if (locals.user) {
			// Already signed in (e.g. via passkey): attach Tessera as an
			// additional identity on the existing account.
			await linkOidcIdentityToUser(locals.user.id, iss, claims.sub);
			user = locals.user;
			linked = true;
		} else {
			user = await createUserWithOidcIdentity(iss, claims.sub, { displayName: claims.name });
			newUser = true;
		}
	}

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

	// New accounts have no Semaphore identity yet — send them to set one up,
	// mirroring the wallet/passkey sign-up paths.
	const needsIdentity = await hasNoActiveIdentity(user.id);
	throw redirect(303, needsIdentity ? '/signup/identity' : '/admin');
};

async function hasNoActiveIdentity(userId: string): Promise<boolean> {
	const rows = await db
		.select({ id: schema.userIdentities.id })
		.from(schema.userIdentities)
		.where(
			and(
				eq(schema.userIdentities.userId, userId),
				eq(schema.userIdentities.status, 'active')
			)
		)
		.limit(1);
	return rows.length === 0;
}
