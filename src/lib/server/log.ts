// Structured logger. Wraps pino so we get JSON in prod (consumable by log
// shippers / observability) and pretty-printed lines in dev. All server code
// should import from here instead of using console.*.
import pino from 'pino';
import { env } from '$env/dynamic/private';
import { dev } from '$app/environment';

const level = env.LOG_LEVEL ?? (dev ? 'debug' : 'info');

export const log = pino({
	level,
	base: {
		service: 'freedink',
		env: env.NODE_ENV ?? (dev ? 'development' : 'production')
	},
	timestamp: pino.stdTimeFunctions.isoTime,
	// Redact secret-shaped fields anywhere in the log payload. Defense in depth
	// — we shouldn't be logging cookies/passwords/tokens at all, but if we
	// accidentally do, they shouldn't show up in logs.
	redact: {
		paths: [
			'password',
			'*.password',
			'token',
			'*.token',
			'cookie',
			'cookies',
			'headers.cookie',
			'headers.authorization',
			'session_id',
			'sid'
		],
		censor: '[REDACTED]'
	},
	transport: dev
		? {
				target: 'pino-pretty',
				options: { colorize: true, translateTime: 'HH:MM:ss.l' }
			}
		: undefined
});

// Helper for request-scoped child loggers.
export function reqLogger(opts: {
	method: string;
	path: string;
	requestId?: string;
	userId?: string | null;
}) {
	return log.child({
		req: { method: opts.method, path: opts.path },
		request_id: opts.requestId,
		user_id: opts.userId ?? undefined
	});
}
