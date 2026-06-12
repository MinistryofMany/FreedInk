// Liveness/readiness probe. Returns 200 when the app process is up *and* the
// database is reachable in under 2 seconds; 503 otherwise so the container
// orchestrator can restart / pull the instance out of rotation. Plain JSON,
// no auth, no rate limiting — must be cheap.
//
// Side-effect: importing $lib/server/shutdown installs the SIGTERM/SIGINT
// handlers and registers the postgres pool closer. We do it here (rather than
// hooks.server.ts, which Wave 2B owns) so a freshly-built server picks up the
// graceful shutdown machinery without coordinating across waves.
import '$lib/server/shutdown';
import { db } from '$lib/db/client';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';

const TIMEOUT_MS = 2_000;

export const GET: RequestHandler = async () => {
	const started = Date.now();
	try {
		await withTimeout(db.execute(sql`SELECT 1`), TIMEOUT_MS);
		return json(200, {
			status: 'ok',
			db: 'ok',
			latency_ms: Date.now() - started,
			ts: new Date().toISOString()
		});
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json(503, {
			status: 'degraded',
			db: message,
			latency_ms: Date.now() - started,
			ts: new Date().toISOString()
		});
	}
};

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
	return new Promise((resolveP, rejectP) => {
		const t = setTimeout(() => rejectP(new Error(`db check timed out after ${ms}ms`)), ms);
		p.then(
			(v) => {
				clearTimeout(t);
				resolveP(v);
			},
			(e) => {
				clearTimeout(t);
				rejectP(e);
			}
		);
	});
}

function json(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json; charset=utf-8',
			// /healthz should never be cached by anything intermediary.
			'cache-control': 'no-store'
		}
	});
}
