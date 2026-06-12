// Server-side Sentry bootstrap. Initialized once at module load. If
// SENTRY_DSN is unset we don't install the SDK — keeps local/dev quiet and
// avoids surprise outbound network traffic in CI.
//
// Note: we only import @sentry/sveltekit when a DSN is configured. This keeps
// the cold-start cost negligible for self-hosters who don't use Sentry, and
// avoids accidentally calling into the SDK before init().
import { env } from '$env/dynamic/private';
import { log } from './log';

let initialized = false;

export function maybeInitSentryServer(): boolean {
	if (initialized) return true;
	const dsn = env.SENTRY_DSN;
	if (!dsn) return false;
	try {
		// Dynamic import so the SDK is only loaded if explicitly opted-in.
		// Top-level await would force every request path to load it.
		// We accept the small first-error latency in exchange.
		import('@sentry/sveltekit')
			.then((Sentry) => {
				Sentry.init({
					dsn,
					environment: env.NODE_ENV ?? 'production',
					// Conservative defaults — operators tune via env if they want more.
					tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE
						? Number(env.SENTRY_TRACES_SAMPLE_RATE)
						: 0
				});
				initialized = true;
				log.info('sentry server SDK initialized');
			})
			.catch((err) => {
				log.warn({ err }, 'failed to initialize sentry server SDK');
			});
		return true;
	} catch (err) {
		log.warn({ err }, 'failed to initialize sentry server SDK');
		return false;
	}
}

// Best-effort error capture. Imported lazily for the same reasons as init.
export async function captureServerError(
	err: unknown,
	context?: Record<string, unknown>
): Promise<void> {
	if (!env.SENTRY_DSN) return;
	try {
		const Sentry = await import('@sentry/sveltekit');
		Sentry.captureException(err, context ? { extra: context } : undefined);
	} catch {
		// swallow — Sentry must never make things worse
	}
}
