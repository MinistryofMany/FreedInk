// Synchronous theme bootstrap. Runs in <head> before first paint so the
// freedink_theme cookie override is applied without a flash of the wrong
// theme (FOUC). When no cookie is set we leave data-theme unset and the CSS
// prefers-color-scheme media query takes over (OS preference path), matching
// the SSR behavior in +layout.server.ts.
//
// Served from static/ as a same-origin external script so it satisfies the
// strict CSP (`script-src 'self'`, no 'unsafe-inline') configured in
// svelte.config.js. An inline <script> would be blocked: under CSP
// `mode: 'hash'` SvelteKit only hashes scripts it generates, not raw ones in
// app.html, and %sveltekit.nonce% yields no usable nonce in hash mode.
(function () {
	try {
		var m = document.cookie.match(/(?:^|;\s*)freedink_theme=([^;]*)/);
		var theme = m ? decodeURIComponent(m[1]) : null;
		if (theme === 'light' || theme === 'dark') {
			document.documentElement.dataset.theme = theme;
		}
	} catch {
		// No cookie access (or malformed value): fall through to the OS
		// prefers-color-scheme path. Never block the document on theme init.
	}
})();
