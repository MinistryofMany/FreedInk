// Boot the built SvelteKit node server for API/E2E tests and return its URL.
// Reuses the test DB so the API endpoints see test fixtures the test process
// just inserted via the drizzle client.
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';

const PORT = Number(process.env.TEST_SERVER_PORT ?? '5174');
const HOST = '127.0.0.1';
export const BASE_URL = `http://${HOST}:${PORT}`;

let child: ChildProcess | null = null;

export async function startServer(): Promise<string> {
	if (child) return BASE_URL;
	if (!existsSync('build/index.js')) {
		throw new Error("build/index.js not found — run 'npm run build' before running API tests");
	}
	child = spawn('node', ['build'], {
		stdio: ['ignore', 'pipe', 'pipe'],
		env: {
			...process.env,
			PORT: String(PORT),
			HOST,
			ORIGIN: BASE_URL,
			PUBLIC_ORIGIN: BASE_URL,
			NODE_ENV: 'production',
			// Drop logs unless explicitly enabled.
			...(process.env.VERBOSE_TEST_SERVER ? {} : { DEBUG: '' })
		}
	});

	const stderr: string[] = [];
	child.stderr?.on('data', (b) => stderr.push(String(b)));
	if (process.env.VERBOSE_TEST_SERVER) {
		child.stdout?.on('data', (b) => process.stdout.write(String(b)));
		child.stderr?.on('data', (b) => process.stderr.write(String(b)));
	}

	const deadline = Date.now() + 30_000;
	while (Date.now() < deadline) {
		try {
			const res = await fetch(BASE_URL + '/');
			if (res.ok || res.status === 303) return BASE_URL;
		} catch {
			// not ready yet
		}
		if (child.exitCode !== null) {
			throw new Error(`server exited early (${child.exitCode}):\n${stderr.join('').slice(-2000)}`);
		}
		await wait(200);
	}
	throw new Error('server did not become ready in 30s');
}

export async function stopServer(): Promise<void> {
	if (!child) return;
	const c = child;
	child = null;
	c.kill('SIGTERM');
	await new Promise<void>((r) => {
		c.on('exit', () => r());
		setTimeout(() => {
			c.kill('SIGKILL');
			r();
		}, 5000);
	});
}
