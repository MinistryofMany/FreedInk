import type { PageServerLoad } from './$types';
import raw from '$lib/content/legal/privacy.md?raw';
import { renderMarkdown } from '$lib/server/markdown';

export const prerender = true;

export const load: PageServerLoad = () => {
	return {
		title: 'Privacy Policy',
		html: renderMarkdown(raw)
	};
};
