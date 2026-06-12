// Owner-only invitation API. POST creates + emails an invite; GET lists the
// invitations for a blog (used by the manage UI). Member assignment doesn't
// happen here — see /api/invite/[token]/accept for the redeem flow.
import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { env as publicEnv } from '$env/dynamic/public';
import { requireRole, ROLES_MANAGING } from '$lib/server/auth';
import { enforce, RULES } from '$lib/server/rate-limit';
import { audit } from '$lib/server/audit';
import { createInvitation, listInvitations } from '$lib/db/invitations';
import { getBlogById } from '$lib/db/blogs';
import { sendMail } from '$lib/server/email';
import { renderInviteEmail } from '$lib/server/email-templates';
import { log } from '$lib/server/log';

const RoleEnum = z.enum(['owner', 'editor', 'reviewer', 'author', 'commenter']);

const CreateBody = z.object({
	blog_id: z.string().uuid(),
	email: z.string().email().max(320),
	role: RoleEnum
});

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	await enforce(RULES.inviteSend, event, { keyBy: 'user' });

	const parsed = CreateBody.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);
	const { blog_id, email, role } = parsed.data;

	await requireRole(blog_id, locals.user.id, ROLES_MANAGING);
	const blog = await getBlogById(blog_id);
	if (!blog) throw error(404, 'blog not found');

	const invite = await createInvitation({
		blogId: blog_id,
		invitedByUserId: locals.user.id,
		email,
		role
	});

	const origin = publicEnv.PUBLIC_ORIGIN ?? '';
	const acceptUrl = `${origin}/invite/${invite.token}`;
	const mail = renderInviteEmail({
		inviterUsername: locals.user.username,
		blogTitle: blog.title,
		role,
		acceptUrl,
		expiresAt: invite.expiresAt
	});
	try {
		await sendMail({
			to: email.trim().toLowerCase(),
			subject: mail.subject,
			text: mail.text,
			html: mail.html
		});
	} catch (err) {
		log.error({ err, invitationId: invite.id }, 'invite sendMail failed');
		// Don't roll back — owner can re-send by creating another invitation if
		// the email transport is borked.
	}

	await audit(event, {
		event: 'blog.member_added',
		actorUserId: locals.user.id,
		subjectBlogId: blog_id,
		metadata: { stage: 'invited', email: email.trim().toLowerCase(), role }
	});

	return json({ ok: true, invitation_id: invite.id, expires_at: invite.expiresAt.toISOString() });
};

export const GET: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) throw error(401, 'sign in required');
	const blogId = url.searchParams.get('blog_id');
	if (!blogId) throw error(422, 'blog_id is required');
	await requireRole(blogId, locals.user.id, ROLES_MANAGING);
	const items = await listInvitations(blogId, {
		includeAccepted: true,
		includeRevoked: true,
		limit: 50
	});
	return json({
		invitations: items.map((i) => ({
			id: i.id,
			email: i.email,
			role: i.role,
			expires_at: i.expiresAt.toISOString(),
			created_at: i.createdAt.toISOString(),
			accepted_at: i.acceptedAt ? i.acceptedAt.toISOString() : null,
			revoked_at: i.revokedAt ? i.revokedAt.toISOString() : null,
			accepted_by_username: i.acceptedByUsername,
			invited_by_username: i.invitedByUsername
		}))
	});
};
