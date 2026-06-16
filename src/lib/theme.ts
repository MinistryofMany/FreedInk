import { browser } from '$app/environment';

/** Theme preference. 'light'/'dark' pin a palette; 'auto'/'system' follow the OS. */
export type ThemePref = 'light' | 'dark' | 'auto' | 'system';

const COOKIE = 'freedink_theme';
const ONE_YEAR = 31536000;

/**
 * Apply a theme preference: set or remove `data-theme` on <html> and persist the
 * `freedink_theme` cookie so SSR renders the right palette on the next request
 * (no FOUC, even on hard reload). 'auto'/'system' clear the override and expire
 * the cookie. No-op on the server.
 *
 * Only call from an event handler or effect, never at render time.
 */
export function applyTheme(pref: ThemePref): void {
	if (!browser) return;
	const html = document.documentElement;
	if (pref === 'light' || pref === 'dark') {
		html.setAttribute('data-theme', pref);
		document.cookie = `${COOKIE}=${pref}; Path=/; Max-Age=${ONE_YEAR}; SameSite=Lax`;
	} else {
		html.removeAttribute('data-theme');
		document.cookie = `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`;
	}
}
