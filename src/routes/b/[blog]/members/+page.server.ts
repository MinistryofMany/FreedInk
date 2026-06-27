import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { listPublicMembers } from '$lib/db/members';

export const load: PageServerLoad = async ({ params }) => {
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');

	// Public, unauthenticated roster of joined members — the visible anonymity
	// set. Only non-sensitive fields are surfaced (username, displayName, role,
	// joinedAt); emails and pending invitations are never exposed here.
	const members = await listPublicMembers(blog.id);

	return {
		Blog: { title: blog.title, slug: blog.slug },
		Members: members.map((m) => ({
			username: m.username,
			displayName: m.displayName,
			role: m.role,
			joinedAt: m.joinedAt
		}))
	};
};
