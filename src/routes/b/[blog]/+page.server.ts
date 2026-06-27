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
			// The blog's author anonymity set: everyone who COULD have written any
			// post, i.e. every active member holding the can_author capability.
			// Filtering on can_author (not the lossy `role` label) is what makes this
			// set correct — a member can hold can_author while their role word says
			// otherwise, and "not a commenter" is not the same predicate as "can
			// author". Shown by display name (falling back to the auto-generated
			// username). Posts are never attributed to an individual contributor: any
			// of these names could have written any post. See the anonymity invariant
			// in llms.txt.
			authors: members
				.filter((m) => m.canAuthor)
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
