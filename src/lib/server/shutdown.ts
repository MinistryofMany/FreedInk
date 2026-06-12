// Graceful shutdown coordinator. hooks.server.ts is expected to wrap incoming
// requests via `withShutdownTracking` so we can wait for in-flight work to
// drain before terminating.
//
// Why we own the signal handlers here (not in hooks.server.ts): hooks.server.ts
// is jointly edited by other waves; concentrating the shutdown logic in a
// single module avoids accidental fragmentation. Wave 2B should compose
// `withShutdownTracking` into their `handle` sequence via `sequence(...)`.
//
// Behaviour on SIGTERM/SIGINT:
//   1. Stop accepting new requests (adapter-node closes the HTTP server).
//   2. Wait up to SHUTDOWN_GRACE_SECONDS (default 25) for in-flight requests
//      to complete — we know the count because `withShutdownTracking` bumps
//      a counter around every request.
//   3. Close the postgres connection pool via pgClient.end().
//   4. process.exit(0).
//
// adapter-node has its own SIGTERM handler that calls server.close() and waits
// for `idleTimeout`; ours runs *in addition* (Node delivers a signal to every
// listener). That works fine — both handlers cooperate. We deliberately leave
// the HTTP layer to the adapter and only own request-draining + pool close.
import type { Handle } from '@sveltejs/kit';

type SignalKind = 'SIGTERM' | 'SIGINT';

// Allow tests / Wave 2B to inject their own pool-close fn instead of importing
// $lib/db/client directly (which would pull a SvelteKit-only env binding into
// pure unit-test contexts).
type PoolCloser = () => Promise<void> | void;

let inFlight = 0;
let shuttingDown = false;
const shutdownComplete: { promise: Promise<void> | null; resolve: (() => void) | null } = {
	promise: null,
	resolve: null
};

// Pool closers registered by the app at boot. Multiple registrations are
// supported (the postgres pool, future redis clients, etc.) and run
// concurrently with a hard upper bound.
const closers: PoolCloser[] = [];

export function registerPoolCloser(fn: PoolCloser): void {
	closers.push(fn);
}

// Test-only: reset counter and pending-shutdown state. Not exported via the
// barrel; consumers shouldn't see this.
export function __resetForTest(): void {
	inFlight = 0;
	shuttingDown = false;
	shutdownComplete.promise = null;
	shutdownComplete.resolve = null;
	closers.length = 0;
}

export function inFlightCount(): number {
	return inFlight;
}

export function isShuttingDown(): boolean {
	return shuttingDown;
}

/**
 * SvelteKit `Handle` middleware that tracks the in-flight request count.
 * Compose into the handle chain via `sequence(withShutdownTracking, ...)`.
 *
 * Once shutdown has begun we still serve in-flight work to completion — we
 * just won't pick up any new requests beyond what the HTTP server already
 * accepted (adapter-node has stopped accept()-ing by then).
 */
export const withShutdownTracking: Handle = async ({ event, resolve }) => {
	inFlight += 1;
	try {
		return await resolve(event);
	} finally {
		inFlight -= 1;
		if (shuttingDown && inFlight === 0 && shutdownComplete.resolve) {
			shutdownComplete.resolve();
		}
	}
};

/**
 * Wait for in-flight requests to drain, capped at `graceMs`. Resolves either
 * when the counter hits zero or the deadline elapses.
 */
export async function drainInFlight(
	graceMs: number
): Promise<{ drained: boolean; remaining: number }> {
	if (inFlight === 0) return { drained: true, remaining: 0 };

	if (!shutdownComplete.promise) {
		shutdownComplete.promise = new Promise<void>((r) => {
			shutdownComplete.resolve = r;
		});
	}

	let timer: NodeJS.Timeout | undefined;
	const timeout = new Promise<'timeout'>((r) => {
		timer = setTimeout(() => r('timeout'), graceMs);
	});

	const winner = await Promise.race([
		shutdownComplete.promise.then(() => 'drained' as const),
		timeout
	]);
	if (timer) clearTimeout(timer);
	return { drained: winner === 'drained', remaining: inFlight };
}

/**
 * Run the full shutdown sequence: mark shutting-down, wait for drain, close
 * pools, then exit. Idempotent — repeated invocations after the first are
 * no-ops.
 */
export async function performShutdown(opts: {
	signal: SignalKind | 'manual';
	graceMs: number;
	exit?: (code: number) => void;
	log?: (line: Record<string, unknown>) => void;
}): Promise<void> {
	if (shuttingDown) return;
	shuttingDown = true;

	const log = opts.log ?? defaultLog;
	const exit = opts.exit ?? ((code: number) => process.exit(code));

	log({
		event: 'shutdown.begin',
		signal: opts.signal,
		in_flight: inFlight,
		grace_ms: opts.graceMs
	});

	const drainResult = await drainInFlight(opts.graceMs);
	log({
		event: drainResult.drained ? 'shutdown.drained' : 'shutdown.drain_timeout',
		remaining: drainResult.remaining
	});

	// Close registered pools in parallel, with an overall hard cap so a stuck
	// connection can't keep us from exiting.
	const closerDeadline = 10_000;
	const closeResult = await Promise.race([
		Promise.allSettled(closers.map((fn) => Promise.resolve().then(fn))),
		new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), closerDeadline))
	]);
	if (closeResult === 'timeout') {
		log({ event: 'shutdown.close_timeout', closers: closers.length });
	} else {
		const failures = closeResult.filter((r) => r.status === 'rejected').length;
		log({ event: 'shutdown.closed', count: closers.length, failures });
	}

	log({ event: 'shutdown.exit', code: 0 });
	exit(0);
}

function defaultLog(line: Record<string, unknown>) {
	// Plain JSON to stderr — avoids tangling with whatever the user's logger
	// happens to be writing to stdout.
	process.stderr.write(JSON.stringify({ ts: new Date().toISOString(), ...line }) + '\n');
}

// ─────────────────────────── auto-registration ───────────────────────────
//
// When this module is loaded in a Node server process we install signal
// handlers and (best-effort) register the postgres pool as a closer. In test
// environments (vitest sets VITEST=true) or in the browser we skip — tests
// can call `performShutdown(...)` directly.

let installed = false;

export function installSignalHandlers(
	opts: { graceMs?: number; log?: (l: Record<string, unknown>) => void } = {}
): void {
	if (installed) return;
	installed = true;

	const graceMs = opts.graceMs ?? Number(process.env.SHUTDOWN_GRACE_SECONDS ?? '25') * 1000;

	const handler = (sig: SignalKind) => {
		void performShutdown({ signal: sig, graceMs, log: opts.log });
	};
	process.on('SIGTERM', () => handler('SIGTERM'));
	process.on('SIGINT', () => handler('SIGINT'));
}

const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
const isBrowser = typeof process === 'undefined' || typeof process.on !== 'function';

if (!isTest && !isBrowser) {
	installSignalHandlers();
	// Best-effort lazy import: at module-load time the SvelteKit synthetic env
	// modules may not have resolved in every environment. queueMicrotask defers
	// past initial module evaluation; failures are non-fatal.
	queueMicrotask(() => {
		void (async () => {
			try {
				const mod = (await import('$lib/db/client')) as {
					closePool?: (o?: { timeoutSeconds?: number }) => Promise<void>;
				};
				if (typeof mod.closePool === 'function') {
					registerPoolCloser(() => mod.closePool!({ timeoutSeconds: 5 }));
				}
			} catch {
				// Pool close is best-effort. Adapter-node will still exit; the
				// OS will reap the TCP sockets postgres-js held.
			}
		})();
	});
}
