import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { listPublishedPostsPage } from '$lib/db/posts';
import { listPublicMembers } from '$lib/db/members';
import { parseLimit } from '$lib/pagination';

export const load: PageServerLoad = async ({ params, url }) => {
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	const cursor = url.searchParams.get('cursor');
	const limit = parseLimit(url.searchParams.get('limit'));
	const [posts, members] = await Promise.all([
		listPublishedPostsPage(blog.id, { cursor, limit }),
		listPublicMembers(blog.id)
	]);
	return {
		Blog: {
			title: blog.title,
			slug: blog.slug,
			description: blog.description,
			// The blog's full contributor set (everyone who could have written any
			// post): owners, editors, reviewers, and authors — everyone except
			// pure commenters. Shown by display name (falling back to the
			// auto-generated username) at the top of the public blog. Posts are
			// never attributed to an individual contributor: any of these names
			// could have written any post. See the anonymity invariant in
			// llms.txt.
			authors: members
				.filter((m) => m.role !== 'commenter')
				.map((m) => m.displayName?.trim() || m.username)
				.sort((a, b) => a.localeCompare(b)),
			// Total count of joined members (the visible anonymity set, including
			// commenters). Drives the "See all members" link to the public roster.
			memberCount: members.length
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
