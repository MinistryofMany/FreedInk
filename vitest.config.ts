import { defineConfig } from 'vitest/config';

// vitest 4 removed workspace files (vitest.workspace.ts) in favor of
// `test.projects`. Each project extends the app's vite config so it inherits
// the SvelteKit plugin, SSR externals, and optimizeDeps.
export default defineConfig({
	test: {
		projects: [
			{
				extends: './vite.config.ts',
				// Force browser-resolve conditions so the Svelte vite plugin
				// compiles components in client mode under jsdom — otherwise the
				// plugin emits SSR-only output and lifecycle hooks won't fire.
				resolve: {
					conditions: ['browser']
				},
				test: {
					name: 'unit',
					include: ['src/**/*.unit.test.ts', 'src/lib/utils.test.ts'],
					environment: 'jsdom',
					setupFiles: ['./tests/setup/load-env.ts'],
					server: {
						deps: {
							inline: ['svelte', /^@tiptap\//, 'tiptap-markdown']
						}
					}
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					include: ['src/**/*.int.test.ts', 'tests/integration/**/*.test.ts'],
					environment: 'node',
					setupFiles: ['./tests/setup/load-env.ts', './tests/setup/integration.ts'],
					globalSetup: ['./tests/setup/global.ts'],
					// Drizzle client is a process-level singleton; serial execution
					// avoids cross-test interference on the same DB.
					fileParallelism: false,
					pool: 'forks',
					poolOptions: { forks: { singleFork: true } },
					testTimeout: 60_000,
					hookTimeout: 60_000
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'api',
					include: ['tests/api/**/*.test.ts'],
					environment: 'node',
					setupFiles: ['./tests/setup/load-env.ts', './tests/setup/integration.ts'],
					globalSetup: ['./tests/setup/api-global.ts'],
					fileParallelism: false,
					pool: 'forks',
					poolOptions: { forks: { singleFork: true } },
					testTimeout: 120_000,
					hookTimeout: 120_000
				}
			}
		]
	}
});
