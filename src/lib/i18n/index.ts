// i18n bootstrap for FreedInk.
//
// Uses svelte-i18n (^4.x) — runtime locale switching with ICU-style
// `{placeholder}` interpolation. This is a *plumbing* commit: English is the
// only locale shipped today, but the system is structured so future
// translations are pure content drops into `locales/<bcp47>.json` plus a
// `register(...)` call below.
//
// Why svelte-i18n over Paraglide:
//   - Paraglide is compile-time and would require pulling its Vite plugin into
//     our build chain (which is already doing snark-artifact prefetch, sentry,
//     drizzle codegen — we don't want another moving part tonight).
//   - svelte-i18n exposes plain Svelte stores (`$_`, `$locale`), which is the
//     minimum we need.
//
// Initialisation is synchronous-on-import. On the browser we re-init the
// locale from `navigator.language` (best-effort, falls back to en). On the
// server, the caller is expected to pass through `negotiateLocale()` (see
// `src/lib/server/locale.ts`) and call `locale.set(...)` per request via a
// hooks.server.ts wire-up — see the project README for the one-line edit.
import { addMessages, init, locale, _, getLocaleFromNavigator } from 'svelte-i18n';
import { browser } from '$app/environment';
import en from './locales/en.json';

export const DEFAULT_LOCALE = 'en';

// Registry of supported locales. Adding a new locale is a two-line change:
// import the JSON, push its tag here.
export const SUPPORTED_LOCALES = ['en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];

// Register all bundled locale message catalogs up front. svelte-i18n is happy
// to be given everything synchronously — we don't have so many strings that
// lazy-loading would matter, and it sidesteps an extra await on first render.
addMessages('en', en);

// Initialise. On the client, pick up the navigator's preferred language if it
// matches one we support; otherwise fall back to en. On the server,
// `initialLocale` defaults to 'en' — the request-level locale is set later by
// hooks (see negotiateLocale).
init({
	fallbackLocale: DEFAULT_LOCALE,
	initialLocale: browser
		? pickSupported(getLocaleFromNavigator()) ?? DEFAULT_LOCALE
		: DEFAULT_LOCALE
});

/**
 * If the given tag (or its language subtag) matches a supported locale,
 * return the supported tag. Otherwise return null so callers can fall back.
 *
 * Examples:
 *   pickSupported('en')      -> 'en'
 *   pickSupported('en-US')   -> 'en'
 *   pickSupported('fr-CA')   -> null
 *   pickSupported(null)      -> null
 */
export function pickSupported(tag: string | null | undefined): SupportedLocale | null {
	if (!tag) return null;
	const lower = tag.toLowerCase();
	// Exact match
	for (const sup of SUPPORTED_LOCALES) {
		if (lower === sup) return sup;
	}
	// Language-subtag match (`en-US` -> `en`)
	const lang = lower.split(/[-_]/)[0];
	for (const sup of SUPPORTED_LOCALES) {
		if (lang === sup) return sup;
	}
	return null;
}

export { _, locale, init };
