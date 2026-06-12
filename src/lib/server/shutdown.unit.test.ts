// Pure unit tests for the shutdown coordinator. We don't touch the DB or fire
// real signals — every observable is driven by direct API calls so the test
// stays fast and deterministic.
import { describe, it, expect, beforeEach } from 'vitest';

// IMPORTANT: import the SUT, then reset its internal state before each test.
// The module installs signal handlers at import time when not in a test
// environment — vitest sets VITEST=true so this is a no-op here.
import {
	withShutdownTracking,
	performShutdown,
	registerPoolCloser,
	inFlightCount,
	isShuttingDown,
	__resetForTest
} from './shutdown';

beforeEach(() => {
	__resetForTest();
});

// Tiny stub of SvelteKit's RequestEvent that withShutdownTracking ignores
// except as the value passed to `resolve`.
const makeEvent = () => ({}) as Parameters<typeof withShutdownTracking>[0]['event'];

describe('withShutdownTracking', () => {
	it('bumps the counter while the request is in flight and decrements after', async () => {
		let observedDuring = -1;
		const resolve = async () => {
			observedDuring = inFlightCount();
			return new Response('ok');
		};
		expect(inFlightCount()).toBe(0);
		await withShutdownTracking({ event: makeEvent(), resolve });
		expect(observedDuring).toBe(1);
		expect(inFlightCount()).toBe(0);
	});

	it('still decrements when the inner handler throws', async () => {
		const resolve = async () => {
			throw new Error('boom');
		};
		await expect(withShutdownTracking({ event: makeEvent(), resolve })).rejects.toThrow('boom');
		expect(inFlightCount()).toBe(0);
	});

	it('tracks concurrent requests independently', async () => {
		let release1: () => void = () => {};
		let release2: () => void = () => {};
		const p1 = withShutdownTracking({
			event: makeEvent(),
			resolve: () =>
				new Promise<Response>((r) => {
					release1 = () => r(new Response('1'));
				})
		});
		const p2 = withShutdownTracking({
			event: makeEvent(),
			resolve: () =>
				new Promise<Response>((r) => {
					release2 = () => r(new Response('2'));
				})
		});
		// Allow both promises to register
		await Promise.resolve();
		expect(inFlightCount()).toBe(2);
		release1();
		await p1;
		expect(inFlightCount()).toBe(1);
		release2();
		await p2;
		expect(inFlightCount()).toBe(0);
	});
});

describe('performShutdown', () => {
	it('exits immediately when no requests are in flight', async () => {
		const logs: Record<string, unknown>[] = [];
		let exitCode: number | undefined;
		await performShutdown({
			signal: 'manual',
			graceMs: 5_000,
			exit: (c) => {
				exitCode = c;
			},
			log: (l) => logs.push(l)
		});
		expect(exitCode).toBe(0);
		expect(isShuttingDown()).toBe(true);
		const events = logs.map((l) => l.event);
		expect(events).toContain('shutdown.begin');
		expect(events).toContain('shutdown.drained');
		expect(events).toContain('shutdown.exit');
	});

	it('waits for in-flight requests to complete before exiting', async () => {
		let release: () => void = () => {};
		const requestP = withShutdownTracking({
			event: makeEvent(),
			resolve: () =>
				new Promise<Response>((r) => {
					release = () => r(new Response('done'));
				})
		});
		// Let the middleware bump the counter.
		await Promise.resolve();
		expect(inFlightCount()).toBe(1);

		const logs: Record<string, unknown>[] = [];
		let exitCode: number | undefined;
		const shutdownP = performShutdown({
			signal: 'SIGTERM',
			graceMs: 2_000,
			exit: (c) => {
				exitCode = c;
			},
			log: (l) => logs.push(l)
		});

		// Give performShutdown a tick to enter its drain wait.
		await new Promise((r) => setTimeout(r, 20));
		expect(exitCode).toBeUndefined(); // still waiting

		release();
		await requestP;
		await shutdownP;

		expect(exitCode).toBe(0);
		const events = logs.map((l) => l.event);
		expect(events).toContain('shutdown.drained');
	}, 5_000);

	it('times out the drain after graceMs if requests never complete', async () => {
		// Start a request that we never release.
		void withShutdownTracking({
			event: makeEvent(),
			resolve: () => new Promise<Response>(() => {})
		});
		await Promise.resolve();
		expect(inFlightCount()).toBe(1);

		const logs: Record<string, unknown>[] = [];
		let exitCode: number | undefined;
		await performShutdown({
			signal: 'SIGTERM',
			graceMs: 50, // very short, will time out
			exit: (c) => {
				exitCode = c;
			},
			log: (l) => logs.push(l)
		});
		expect(exitCode).toBe(0);
		const events = logs.map((l) => l.event);
		expect(events).toContain('shutdown.drain_timeout');
	}, 5_000);

	it('invokes registered pool closers and is idempotent', async () => {
		let calls = 0;
		registerPoolCloser(async () => {
			calls += 1;
		});
		const logs: Record<string, unknown>[] = [];
		await performShutdown({
			signal: 'manual',
			graceMs: 100,
			exit: () => {},
			log: (l) => logs.push(l)
		});
		expect(calls).toBe(1);
		// Second call is a no-op.
		await performShutdown({
			signal: 'manual',
			graceMs: 100,
			exit: () => {},
			log: (l) => logs.push(l)
		});
		expect(calls).toBe(1);
	});
});
