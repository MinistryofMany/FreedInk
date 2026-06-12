import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { hasRole, ROLES_REVIEWING } from '$lib/server/auth';
import { getPostsUnderReviewPage } from '$lib/db/posts';
import { getReviewSummary } from '$lib/server/tally';
import { parseLimit } from '$lib/pagination';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, locals.user.id, ROLES_REVIEWING)))
		throw redirect(303, '/admin');

	const cursor = url.searchParams.get('cursor');
	const limit = parseLimit(url.searchParams.get('limit'));
	const page = await getPostsUnderReviewPage([blog.id], { cursor, limit });
	const enriched = await Promise.all(
		page.items.map(async (p) => ({
			...p,
			tally: await getReviewSummary(p.version.id)
		}))
	);
	return {
		blog: { id: blog.id, slug: blog.slug, title: blog.title },
		posts: enriched,
		nextCursor: page.nextCursor
	};
};
