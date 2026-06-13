import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { enforce, RULES } from '$lib/server/rate-limit';
import {
	oidcConfig,
	generatePkce,
	randomUrlToken,
	buildAuthorizationUrl,
	safeNext,
	NEXT_COOKIE
} from '$lib/server/oidc';

// Begin "Sign in with Tessera". Generates PKCE + state + nonce, persists the
// pending authorization, and redirects the browser to Tessera's consent
// screen. A GET (not a JSON POST) so the signup page can link straight to it;
// the per-request `state` is what protects the callback. An optional `?next=`
// (same-origin path only) is stashed in a short-lived cookie so the callback
// can return the user where they started (e.g. an invitation link).
export const GET: RequestHandler = async (event) => {
	await enforce(RULES.authStart, event, { keyBy: 'ip' });

	const cfg = oidcConfig();
	if (!cfg) throw error(503, 'Tessera sign-in is not configured');

	const next = safeNext(event.url.searchParams.get('next'));
	if (next) {
		event.cookies.set(NEXT_COOKIE, next, {
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: event.url.protocol === 'https:',
			maxAge: 10 * 60
		});
	} else {
		event.cookies.delete(NEXT_COOKIE, { path: '/' });
	}

	const { verifier, challenge } = generatePkce();
	const state = randomUrlToken();
	const nonce = randomUrlToken();

	await db.insert(schema.oidcSessions).values({
		state,
		nonce,
		codeVerifier: verifier,
		expiresAt: new Date(Date.now() + 10 * 60 * 1000)
	});

	const url = await buildAuthorizationUrl(cfg, { state, nonce, codeChallenge: challenge });
	throw redirect(302, url);
};
