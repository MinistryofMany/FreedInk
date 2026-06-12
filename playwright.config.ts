import { defineConfig, devices } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

// Load .env.test into process.env before any config field reads it. Playwright
// has no awareness of dotenv-style files, and the webServer it spawns inherits
// whatever's in process.env at config-load time.
if (existsSync('.env.test')) {
	for (const raw of readFileSync('.env.test', 'utf8').split('\n')) {
		const line = raw.replace(/\r$/, '');
		const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
		if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
	}
}

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? '5175');
// Use `localhost` (not 127.0.0.1): WebAuthn's "secure context" exception is
// scoped to the literal hostname `localhost`, not arbitrary loopback IPs.
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
	testDir: './e2e',
	timeout: 60_000,
	expect: { timeout: 10_000 },
	fullyParallel: false,
	workers: 1,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL: BASE_URL,
		trace: 'on-first-retry',
		video: 'retain-on-failure',
		screenshot: 'only-on-failure'
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'], channel: undefined }
		}
	],
	webServer: {
		// Build is assumed to be fresh; e2e runner rebuilds via npm script.
		command: `node build`,
		url: BASE_URL,
		reuseExistingServer: !process.env.CI,
		timeout: 60_000,
		stdout: 'pipe',
		stderr: 'pipe',
		env: {
			...process.env,
			PORT: String(PORT),
			HOST: '127.0.0.1',
			ORIGIN: BASE_URL,
			PUBLIC_ORIGIN: BASE_URL,
			PUBLIC_RP_ID: 'localhost',
			PUBLIC_RP_NAME: 'Freed Ink E2E',
			NODE_ENV: 'production'
		}
	},
	globalSetup: './e2e/global-setup.ts'
});
