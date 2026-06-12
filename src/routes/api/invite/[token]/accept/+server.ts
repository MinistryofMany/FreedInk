// POST /api/invite/[token]/accept — auth required. Marks the invitation
// accepted, adds the signed-in user to the blog with the invitation's role,
// emits a `blog.member_added` audit row. Returns the blog slug so the client
// can redirect into the admin view for the blog.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { acceptInvitation } from '$lib/db/invitations';
import { audit } from '$lib/server/audit';

export const POST: RequestHandler = async (event) => {
	const { params, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const token = params.token;
	if (!token) throw error(404, 'invitation not found');

	const result = await acceptInvitation({ token, userId: locals.user.id });

	if (!result.alreadyMember) {
		await audit(event, {
			event: 'blog.member_added',
			actorUserId: locals.user.id,
			subjectUserId: locals.user.id,
			subjectBlogId: result.blogId,
			metadata: { role: result.role, via: 'invite', invitation_id: result.invitationId }
		});
	}

	return json({
		ok: true,
		blog_slug: result.blogSlug,
		blog_id: result.blogId,
		role: result.role,
		already_member: result.alreadyMember
	});
};
