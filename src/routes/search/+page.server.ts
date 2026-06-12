import type { PageServerLoad } from './$types';
import { searchPublishedPostsPage, listAllTags } from '$lib/db/tags';
import { parseLimit } from '$lib/pagination';

export const load: PageServerLoad = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const tag = url.searchParams.get('tag') ?? '';
	const cursor = url.searchParams.get('cursor');
	const limit = parseLimit(url.searchParams.get('limit'));
	const page = await searchPublishedPostsPage({
		query: q || undefined,
		tagSlug: tag || undefined,
		cursor,
		limit
	});
	const tags = await listAllTags();
	return {
		q,
		tag,
		results: page.items,
		nextCursor: page.nextCursor,
		tags
	};
};
