// Prometheus exposition endpoint. Always returns text/plain; version=0.0.4 in
// the standard format. The endpoint is NEVER public: a request is authorized
// only if EITHER it carries `Authorization: Bearer <METRICS_BEARER>` (matched
// constant-time) OR it comes from a logged-in platform operator session. If
// METRICS_BEARER is unset there is no bearer path at all — an operator session
// is then the only way in. Anything else gets 403.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '$env/dynamic/private';
import { collectAllMetrics, renderPrometheus } from '$lib/server/metrics';
import { isPlatformOperator } from '$lib/server/operators';
import type { RequestHandler } from './$types';

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

// Constant-time string compare. We HMAC both sides to fixed-width digests
// before comparing so timingSafeEqual never sees mismatched lengths (which it
// throws on) and the comparison time does not leak the secret's length.
function constantTimeEquals(a: string, b: string): boolean {
	const key = 'metrics-bearer-compare';
	const da = createHmac('sha256', key).update(a).digest();
	const db = createHmac('sha256', key).update(b).digest();
	return timingSafeEqual(da, db);
}

function bearerMatches(authHeader: string, bearer: string): boolean {
	const prefix = 'Bearer ';
	if (!authHeader.startsWith(prefix)) return false;
	const presented = authHeader.slice(prefix.length).trim();
	if (!presented) return false;
	return constantTimeEquals(presented, bearer);
}

export const GET: RequestHandler = async ({ request, locals }) => {
	const bearer = env.METRICS_BEARER?.trim();
	const auth = request.headers.get('authorization') ?? '';

	const viaBearer = bearer ? bearerMatches(auth, bearer) : false;
	const viaOperator = isPlatformOperator(locals.user);

	if (!viaBearer && !viaOperator) {
		const headers: Record<string, string> = {
			'content-type': 'text/plain; charset=utf-8',
			'cache-control': 'no-store'
		};
		// Only advertise the bearer challenge when a bearer is actually
		// configured; otherwise it would mislead scrapers into retrying with a
		// token that can never work.
		if (bearer) headers['www-authenticate'] = 'Bearer realm="metrics"';
		return new Response('forbidden\n', { status: 403, headers });
	}

	const metrics = await collectAllMetrics();
	const body = renderPrometheus(metrics);
	return new Response(body, {
		status: 200,
		headers: {
			'content-type': CONTENT_TYPE,
			// Prometheus polls every N seconds; caching would give stale data
			// and confuse rate() calculations.
			'cache-control': 'no-store'
		}
	});
};
