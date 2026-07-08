// Posts index for a blog: a moderator-facing list of every post (any status,
// including archived) with a link into each post's moderation detail. Gated on
// the same MODERATING set (owner/editor) as the detail page — the operator
// bypass rides in through hasRole.
import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { hasRole } from '$lib/server/auth';
import { listAllPostsPage } from '$lib/db/posts';
import { parseLimit } from '$lib/pagination';

const MODERATING = ['owner', 'editor'] as const;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, locals.user.id, MODERATING))) throw redirect(303, '/admin');

	const cursor = url.searchParams.get('cursor');
	const limit = parseLimit(url.searchParams.get('limit'));
	const page = await listAllPostsPage(blog.id, { cursor, limit });

	return {
		blog: { id: blog.id, slug: blog.slug, title: blog.title },
		posts: page.items.map((p) => ({
			id: p.id,
			status: p.status,
			createdAt: p.createdAt.toISOString(),
			title: p.version?.title ?? '(no current version)',
			slug: p.version?.slug ?? null
		})),
		nextCursor: page.nextCursor
	};
};
