import type { PageServerLoad } from './$types';
import raw from '$lib/content/legal/terms.md?raw';
import { renderMarkdown } from '$lib/server/markdown';

export const prerender = true;

export const load: PageServerLoad = () => {
	return {
		title: 'Terms of Service',
		html: renderMarkdown(raw)
	};
};
