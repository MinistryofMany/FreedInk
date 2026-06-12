import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { listPublishedPostsPage } from '$lib/db/posts';
import { listMembers } from '$lib/db/members';
import { parseLimit } from '$lib/pagination';

export const load: PageServerLoad = async ({ params, url }) => {
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	const cursor = url.searchParams.get('cursor');
	const limit = parseLimit(url.searchParams.get('limit'));
	const [posts, members] = await Promise.all([
		listPublishedPostsPage(blog.id, { cursor, limit }),
		listMembers(blog.id)
	]);
	return {
		Blog: {
			title: blog.title,
			slug: blog.slug,
			description: blog.description,
			authors: members
				.filter((m) => m.role !== 'commenter')
				.map((m) => m.user.username)
				.sort()
		},
		Posts: posts.items.map((p) => ({
			id: p.id,
			title: p.version.title,
			content: p.version.content,
			slug: p.version.slug,
			published_at: p.version.publishedAt
		})),
		nextCursor: posts.nextCursor
	};
};
