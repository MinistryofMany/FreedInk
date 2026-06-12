// Prometheus exposition endpoint. Always returns text/plain; version=0.0.4 in
// the standard format. By default the endpoint is open (operators are expected
// to restrict it at the network layer — e.g. only the scraper IP can reach
// it). If METRICS_BEARER is set in the environment, we additionally require
// `Authorization: Bearer <that-value>` and 401 on anything else; this lets a
// public-internet deployment expose /metrics safely without fronting it.
import { env } from '$env/dynamic/private';
import { collectAllMetrics, renderPrometheus } from '$lib/server/metrics';
import type { RequestHandler } from './$types';

const CONTENT_TYPE = 'text/plain; version=0.0.4; charset=utf-8';

export const GET: RequestHandler = async ({ request }) => {
	const bearer = env.METRICS_BEARER?.trim();
	if (bearer) {
		const auth = request.headers.get('authorization') ?? '';
		const expected = `Bearer ${bearer}`;
		if (auth !== expected) {
			return new Response('unauthorized\n', {
				status: 401,
				headers: {
					'content-type': 'text/plain; charset=utf-8',
					'cache-control': 'no-store',
					// Hint to scrapers and humans alike.
					'www-authenticate': 'Bearer realm="metrics"'
				}
			});
		}
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
