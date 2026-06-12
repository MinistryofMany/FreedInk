import { error, redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getBlogBySlug } from '$lib/db/blogs';
import { listMembers } from '$lib/db/members';
import { listInvitations } from '$lib/db/invitations';
import { listAllPostsPage } from '$lib/db/posts';
import { hasRole, ROLES_MANAGING } from '$lib/server/auth';
import { parseLimit } from '$lib/pagination';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (!locals.user) throw redirect(303, '/signup');
	const blog = await getBlogBySlug(params.blog);
	if (!blog) throw error(404, 'blog not found');
	if (!(await hasRole(blog.id, locals.user.id, ROLES_MANAGING))) throw redirect(303, '/admin');
	const members = await listMembers(blog.id);
	const invitations = await listInvitations(blog.id, {
		includeAccepted: true,
		includeRevoked: true,
		limit: 50
	});
	// Paginated posts list (cursor-driven). Wave 3C owns the +page.svelte and
	// may consume `posts` + `postsNextCursor` here; we just expose them.
	const postsCursor = url.searchParams.get('postsCursor');
	const postsLimit = parseLimit(url.searchParams.get('postsLimit'));
	const postsPage = await listAllPostsPage(blog.id, {
		cursor: postsCursor,
		limit: postsLimit
	});
	return {
		blog,
		members: members.map((m) => ({
			id: m.id,
			user_id: m.user.id,
			username: m.user.username,
			displayName: m.user.displayName,
			role: m.role,
			addedAt: m.addedAt
		})),
		invitations: invitations.map((i) => ({
			id: i.id,
			email: i.email,
			role: i.role,
			expiresAt: i.expiresAt.toISOString(),
			createdAt: i.createdAt.toISOString(),
			acceptedAt: i.acceptedAt ? i.acceptedAt.toISOString() : null,
			revokedAt: i.revokedAt ? i.revokedAt.toISOString() : null,
			acceptedByUsername: i.acceptedByUsername,
			invitedByUsername: i.invitedByUsername
		})),
		posts: postsPage.items,
		postsNextCursor: postsPage.nextCursor
	};
};
