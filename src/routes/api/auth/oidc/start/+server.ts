import type { RequestHandler } from './$types';
import { error, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { enforce, RULES } from '$lib/server/rate-limit';
import { oidcConfig, beginAuthorization, safeNext, NEXT_COOKIE } from '$lib/server/oidc';

// Begin "Sign in with Minister". Generates PKCE + state + nonce, persists the
// pending authorization, and redirects the browser to Minister's consent
// screen. A GET (not a JSON POST) so the signup page can link straight to it;
// the per-request `state` is what protects the callback. An optional `?next=`
// (same-origin path only) is stashed in a short-lived cookie so the callback
// can return the user where they started (e.g. an invitation link).
export const GET: RequestHandler = async (event) => {
	await enforce(RULES.authStart, event, { keyBy: 'ip' });

	const cfg = oidcConfig();
	if (!cfg) throw error(503, 'Minister sign-in is not configured');

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

	const { url, flow } = await beginAuthorization(cfg);

	await db.insert(schema.oidcSessions).values({
		state: flow.state,
		nonce: flow.nonce,
		codeVerifier: flow.codeVerifier,
		expiresAt: new Date(flow.expiresAt)
	});

	throw redirect(302, url);
};
