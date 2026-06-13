import type { LayoutServerLoad } from './$types';

// Theme cookie name — shared with /settings page. Stored client-side via
// document.cookie (or server-side via setCookie in a page action). Values:
// 'light' | 'dark' | undefined (= follow OS preference via media query).
// Underscore-prefixed so SvelteKit doesn't reject the export from this
// layout module (only `load`, `prerender`, etc., are allowed by default).
const THEME_COOKIE = 'freedink_theme';

function readTheme(raw: string | undefined): 'light' | 'dark' | null {
	if (raw === 'light' || raw === 'dark') return raw;
	return null;
}

export const load: LayoutServerLoad = async ({ locals, cookies }) => {
	const theme = readTheme(cookies.get(THEME_COOKIE));
	const base = { theme, locale: locals.locale ?? 'en' } as const;
	if (!locals.user) return { ...base, user: null };
	return {
		...base,
		user: {
			id: locals.user.id,
			username: locals.user.username,
			displayName: locals.user.displayName,
			email: locals.user.email
		}
	};
};
