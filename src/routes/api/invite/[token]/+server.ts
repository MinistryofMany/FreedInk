// Public lookup for an invitation token. Returns the context (blog title,
// role, inviter username, expiresAt) so the public /invite/[token] landing
// page can render something useful. 410 on missing/expired/revoked/accepted
// so the client knows the token is dead rather than just unknown.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getInvitationByToken } from '$lib/db/invitations';

export const GET: RequestHandler = async ({ params }) => {
	const token = params.token;
	if (!token) throw error(404, 'invitation not found');
	const ctx = await getInvitationByToken(token);
	if (!ctx) throw error(410, 'invitation token is invalid, expired, or already used');
	return json({
		blog_title: ctx.blogTitle,
		blog_slug: ctx.blogSlug,
		role: ctx.role,
		email: ctx.email,
		inviter_username: ctx.inviterUsername,
		expires_at: ctx.expiresAt.toISOString()
	});
};
