// Server hook chain. Responsibilities:
//   1. Initialize Sentry (no-op if SENTRY_DSN unset)
//   2. Assign a per-request id (echoed back as X-Request-Id)
//   3. Same-origin guard for unsafe JSON requests under /api/
//   4. Load the session user into event.locals.user
//   5. Resolve the response and attach security headers
//   6. Emit one JSON log line per request
//
// All of this runs inside SvelteKit's single `handle` hook. We keep the chain
// inline (rather than `sequence(...)`) so the order is obvious and we can
// short-circuit early on CSRF rejection without paying for downstream work.
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { dev } from '$app/environment';
import { randomUUID } from 'node:crypto';
import { loadSessionUser, SESSION_COOKIE_NAME } from '$lib/server/session';
import { log, reqLogger } from '$lib/server/log';
import { maybeInitSentryServer, captureServerError } from '$lib/server/sentry';
import {
	withShutdownTracking,
	installSignalHandlers,
	isShuttingDown
} from '$lib/server/shutdown';
import { negotiateLocale } from '$lib/server/locale';

// Initialize Sentry once at module load. No-op if SENTRY_DSN is unset.
maybeInitSentryServer();

// Install SIGTERM/SIGINT handlers once at module load. Drains in-flight
// requests (tracked by withShutdownTracking below) up to SHUTDOWN_GRACE_SECONDS
// before closing the pg pool and exiting.
installSignalHandlers({ log: (line) => log.info(line, 'shutdown') });

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// CSP is configured in svelte.config.js (kit.csp). SvelteKit emits it as a
// `Content-Security-Policy` HTTP header with auto-hashed inline scripts so
// hydration works without 'unsafe-inline'. Don't set CSP here or the two
// headers will merge under "most restrictive wins" semantics and break the
// boot script.

const PERMISSIONS_POLICY =
	'camera=(), microphone=(), geolocation=(), payment=(), ' +
	'publickey-credentials-get=(self), publickey-credentials-create=(self)';

function isHealthz(pathname: string): boolean {
	return pathname === '/healthz';
}

function isHttpsRequest(url: URL, headers: Headers): boolean {
	if (url.protocol === 'https:') return true;
	// Honor X-Forwarded-Proto when running behind a reverse proxy (Caddy).
	const xfp = headers.get('x-forwarded-proto');
	if (xfp && xfp.split(',')[0].trim().toLowerCase() === 'https') return true;
	return false;
}

const mainHandle: Handle = async ({ event, resolve }) => {
	const started = performance.now();
	const requestId = event.request.headers.get('x-request-id') ?? randomUUID();
	event.locals.requestId = requestId;

	// During shutdown, fail new requests fast rather than admitting them and
	// then aborting mid-flight. 503 is the right signal for "drain me".
	if (isShuttingDown()) {
		return new Response('Server is shutting down', {
			status: 503,
			headers: { 'Retry-After': '15', 'x-request-id': requestId }
		});
	}

	// Same-origin guard for JSON API mutations. SvelteKit's default CSRF
	// check covers form posts via the Origin header; for JSON we add our own
	// because JSON requests can be made cross-origin without preflight if the
	// content-type is `text/plain` (the simple-request loophole). We reject
	// mismatched origins for *every* unsafe JSON POST under /api/.
	const pathname = event.url.pathname;
	const method = event.request.method.toUpperCase();
	const isApi = pathname.startsWith('/api/');
	if (isApi && UNSAFE_METHODS.has(method)) {
		const ct = event.request.headers.get('content-type') ?? '';
		const origin = event.request.headers.get('origin');
		if (origin && ct.toLowerCase().includes('application/json')) {
			if (origin !== event.url.origin) {
				log.warn(
					{ request_id: requestId, origin, expected: event.url.origin, path: pathname },
					'csrf: origin mismatch'
				);
				return new Response('Forbidden: cross-origin request', {
					status: 403,
					headers: { 'x-request-id': requestId }
				});
			}
		}
	}

	// Load session user (keeps the pre-existing behavior).
	const raw = event.cookies.get(SESSION_COOKIE_NAME);
	event.locals.user = (await loadSessionUser(raw)) ?? null;

	// Pick the negotiated locale: explicit `locale` cookie wins, else
	// q-weighted Accept-Language, else 'en'. Forwarded to the client by
	// +layout.server.ts so SSR and hydration agree.
	event.locals.locale = negotiateLocale(event.request, event.cookies.get('locale'));

	const response = await resolve(event);

	// CSP is set by SvelteKit (see svelte.config.js kit.csp). The other
	// security headers are applied here. /healthz skips HSTS — it's an
	// internal probe endpoint.
	const isHealth = isHealthz(pathname);
	if (!isHealth) {
		// HSTS only in prod / when the request is https. Avoids sending it in
		// local dev where browsers would then refuse plain-http.
		if (!dev && isHttpsRequest(event.url, event.request.headers)) {
			response.headers.set(
				'Strict-Transport-Security',
				'max-age=63072000; includeSubDomains; preload'
			);
		}
	}
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('Permissions-Policy', PERMISSIONS_POLICY);
	response.headers.set('X-Request-Id', requestId);

	// One structured log line per request. Keep at info; status >=500 gets
	// bumped to error so it shows up under default filter.
	const durationMs = Math.round(performance.now() - started);
	const child = reqLogger({
		method,
		path: pathname,
		requestId,
		userId: event.locals.user?.id ?? null
	});
	const logFn = response.status >= 500 ? child.error : child.info;
	logFn.call(
		child,
		{ status: response.status, duration_ms: durationMs },
		'request'
	);

	return response;
};

// Compose: shutdown tracking wraps everything so the in-flight counter is
// always accurate and the drain logic works correctly on SIGTERM.
export const handle: Handle = sequence(withShutdownTracking, mainHandle);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	const requestId = event.locals.requestId;
	log.error(
		{
			err: error,
			request_id: requestId,
			path: event.url.pathname,
			status
		},
		'unhandled server error'
	);
	// Fire-and-forget — never block error response on Sentry.
	void captureServerError(error, {
		path: event.url.pathname,
		method: event.request.method,
		request_id: requestId
	});
	return { message: message ?? 'Internal Error' };
};
