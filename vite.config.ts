/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
	plugins: [sveltekit()],
	define: {
		// Build-day stamp (YYYY-MM-DD) baked in at build time for the "Beta ·
		// {date}" footer label. Typed globally in src/vite-env.d.ts.
		__BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10))
	},
	resolve: {
		alias: [
			// FreedInk is Semaphore-only and does NOT install the optional peer
			// @ministryofmany/rln. @ministryofmany/membership keeps its RLN engine behind
			// a lazy dynamic import (never loaded at runtime here), but the bundler still
			// resolves that lazy chunk's named imports from @ministryofmany/rln at build
			// time. Alias the absent peer to a stub that provides those names so the build
			// resolves; the chunk is never executed. See src/lib/rln-absent-stub.ts.
			{
				find: /^@ministryofmany\/rln$/,
				replacement: fileURLToPath(new URL('./src/lib/rln-absent-stub.ts', import.meta.url))
			}
		]
	},
	ssr: {
		// Semaphore packages load WASM at runtime — let the SSR pipeline import
		// them through Node's resolver instead of trying to bundle them.
		external: [
			'@semaphore-protocol/core',
			'@semaphore-protocol/group',
			'@semaphore-protocol/proof',
			'nodemailer'
		]
	},
	build: {
		rollupOptions: {
			external: ['nodemailer']
		}
	},
	optimizeDeps: {
		exclude: ['@semaphore-protocol/proof'],
		// Because @semaphore-protocol/proof is excluded, its dependency tree is
		// served raw in dev. @zk-kit/utils in that tree does
		// `import { Buffer } from 'buffer'`, and the `buffer` npm package is CJS —
		// without prebundling, the browser receives the CJS file as-is and fails
		// with "does not provide an export named 'Buffer'". Prebundling `buffer`
		// gives the raw-served modules an ESM interop wrapper to import instead.
		include: ['buffer']
	}
	// Test config lives in vitest.workspace.ts — each project there supplies
	// its own include/environment/setup files.
});
