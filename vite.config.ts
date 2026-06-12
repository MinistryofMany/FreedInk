/// <reference types="vitest/config" />
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
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
