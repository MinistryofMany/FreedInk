// Client-side Sentry bootstrap. No-op if PUBLIC_SENTRY_DSN is unset so
// self-hosters who don't care about observability don't pay any cost.
//
// `handleError` is wired even when Sentry is disabled — it falls through to
// SvelteKit's default behavior (logging + returning a generic message).
import type { HandleClientError } from '@sveltejs/kit';
import { env as publicEnv } from '$env/dynamic/public';
import { captureMinisterAppSecret } from '$lib/client/minister-anon';

// Capture + scrub the Ministry anonymous-identity fragment BEFORE anything
// else runs client-side: Sentry (or any later script reading location.href)
// must never see the secret, and no client-side navigation may run first —
// the fragment only survives server-side 3xx redirects (anon-identity spec
// §8.4, findings S3/S4). This module is the earliest first-party code
// SvelteKit executes in the browser, ahead of hydration and the router.
captureMinisterAppSecret();

let sentryReady: Promise<void> | null = null;

if (publicEnv.PUBLIC_SENTRY_DSN) {
	sentryReady = import('@sentry/sveltekit')
		.then((Sentry) => {
			Sentry.init({
				dsn: publicEnv.PUBLIC_SENTRY_DSN,
				// Conservative defaults — operators can tune via build-time env.
				tracesSampleRate: publicEnv.PUBLIC_SENTRY_TRACES_SAMPLE_RATE
					? Number(publicEnv.PUBLIC_SENTRY_TRACES_SAMPLE_RATE)
					: 0,
				environment: publicEnv.PUBLIC_SENTRY_ENVIRONMENT ?? 'production'
			});
		})
		.catch((err) => {
			console.warn('failed to load sentry browser SDK', err);
		});
}

export const handleError: HandleClientError = async ({ error, event }) => {
	if (sentryReady) {
		try {
			await sentryReady;
			const Sentry = await import('@sentry/sveltekit');
			Sentry.captureException(error, {
				extra: { path: event.url?.pathname }
			});
		} catch {
			// swallow — never throw from handleError
		}
	}

	console.error('client error', error);
	return { message: 'Something went wrong.' };
};
