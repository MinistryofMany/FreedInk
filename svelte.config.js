import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter(),
		// SvelteKit emits inline boot scripts for hydration. CSP must allow them
		// somehow. We use `mode: 'hash'` so SvelteKit auto-computes sha256 hashes
		// for each emitted inline script and injects them into the CSP — no
		// 'unsafe-inline' needed.
		//
		// IMPORTANT: when CSP is configured here, hooks.server.ts must NOT also
		// set a Content-Security-Policy response header, or the browser will
		// merge them under "most restrictive wins" and the resulting policy may
		// reject SvelteKit's bootstrap.
		//
		// 'wasm-unsafe-eval' is required for the Semaphore proof system (snarkjs)
		// to compile its WASM modules in the browser.
		// connect-src includes snark-artifacts.pse.dev as the CDN fallback for
		// proving artifacts we vendor at /snark-artifacts/.
		// Fonts (Lato, Source Code Pro) are self-hosted under /fonts, so
		// style-src/font-src need no third-party origins.
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self', 'wasm-unsafe-eval'],
				'style-src': ['self', 'unsafe-inline'],
				'img-src': ['self', 'data:', 'blob:'],
				'font-src': ['self', 'data:'],
				'connect-src': ['self', 'https://snark-artifacts.pse.dev'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'object-src': ['none'],
				'worker-src': ['self', 'blob:']
			}
		}
	}
};

export default config;
