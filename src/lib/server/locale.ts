// Server-side locale negotiation.
//
// Priority order (first non-null wins):
//   1. The `locale` cookie (set when the user picks a language in the UI).
//   2. The `Accept-Language` request header (RFC 7231 / 9110 — comma-separated
//      list with optional q-weights; we take the first supported entry by
//      descending quality).
//   3. The default locale, 'en'.
//
// This module is server-only. It is intentionally tiny and dependency-free so
// it can be imported from `hooks.server.ts` without dragging svelte-i18n into
// the server bundle.
//
// To wire SSR-side: in `src/hooks.server.ts`, inside the main handler:
//
//   import { negotiateLocale } from '$lib/server/locale';
//   event.locals.locale = negotiateLocale(event.request, event.cookies.get('locale'));
//
// …then forward `locals.locale` into the +layout.server.ts data payload so
// the client can call `locale.set()` on hydration.
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, pickSupported } from '$lib/i18n';

const LOCALE_SET: ReadonlySet<string> = new Set(SUPPORTED_LOCALES);

/**
 * Negotiates the best supported locale for a request.
 *
 * @param req - The incoming Request (we only read its `accept-language`
 *   header — passing a bare `Request` object is fine).
 * @param cookie - The raw value of the `locale` cookie, or `undefined` if
 *   not set. Caller is responsible for reading it (typically via
 *   `event.cookies.get('locale')`).
 * @returns A supported locale tag. Falls back to `'en'`.
 */
export function negotiateLocale(req: Request, cookie: string | undefined): string {
	// 1. Cookie wins — the user has explicitly picked this.
	if (cookie && LOCALE_SET.has(cookie)) return cookie;

	// 2. Accept-Language header. Parse weights and try supported matches in
	//    descending quality order.
	const header = req.headers.get('accept-language');
	if (header) {
		const parsed = parseAcceptLanguage(header);
		for (const tag of parsed) {
			const match = pickSupported(tag);
			if (match) return match;
		}
	}

	// 3. Default.
	return DEFAULT_LOCALE;
}

/**
 * Parses an Accept-Language header into a quality-ordered list of language
 * tags. Returns lowercase tags. Skips entries with q=0.
 *
 * Examples:
 *   "en-US,en;q=0.9,fr;q=0.5" -> ["en-us", "en", "fr"]
 *   "*"                       -> ["*"]
 *   ""                        -> []
 */
function parseAcceptLanguage(header: string): string[] {
	return header
		.split(',')
		.map((part) => {
			const [rawTag, ...params] = part.trim().split(';');
			let q = 1;
			for (const p of params) {
				const [k, v] = p.split('=').map((s) => s.trim());
				if (k === 'q') {
					const parsed = Number(v);
					if (Number.isFinite(parsed)) q = parsed;
				}
			}
			return { tag: rawTag.trim().toLowerCase(), q };
		})
		.filter((entry) => entry.tag.length > 0 && entry.q > 0)
		.sort((a, b) => b.q - a.q)
		.map((entry) => entry.tag);
}
