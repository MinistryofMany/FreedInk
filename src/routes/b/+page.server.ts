import type { PageServerLoad } from './$types';
import { listBlogsPage } from '$lib/db/blogs';
import { parseLimit } from '$lib/pagination';

export const load: PageServerLoad = async ({ url }) => {
	const cursor = url.searchParams.get('cursor');
	const limit = parseLimit(url.searchParams.get('limit'));
	const page = await listBlogsPage({ cursor, limit });
	return {
		Blogs: page.items,
		nextCursor: page.nextCursor
	};
};
