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
		exclude: ['@semaphore-protocol/proof']
	}
	// Test config lives in vitest.workspace.ts — each project there supplies
	// its own include/environment/setup files.
});
