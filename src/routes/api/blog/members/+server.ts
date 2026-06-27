import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { z } from 'zod';
import { requireRole, requireCapability, ROLES_MANAGING } from '$lib/server/auth';
import { setRole, removeMember, getActiveMember, changeCapabilities } from '$lib/db/members';
import { getUserByUsername } from '$lib/db/users';
import { audit } from '$lib/server/audit';

const RoleEnum = z.enum(['owner', 'editor', 'reviewer', 'author', 'commenter']);

const SetBody = z.object({
	blog_id: z.string().uuid(),
	target: z.object({
		username: z.string().optional()
	}),
	role: RoleEnum
});

const RemoveBody = z.object({
	blog_id: z.string().uuid(),
	target_user_id: z.string().uuid()
});

async function resolveTarget(target: { username?: string }) {
	if (target.username) return getUserByUsername(target.username);
	return null;
}

export const POST: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = SetBody.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	await requireRole(parsed.data.blog_id, locals.user.id, ROLES_MANAGING);
	const target = await resolveTarget(parsed.data.target);
	if (!target) throw error(404, 'target user not found');
	if (target.id === locals.user.id) throw error(409, "you can't change your own role");

	const existing = await getActiveMember(parsed.data.blog_id, target.id);
	const isRoleChange = !!existing;

	await setRole(parsed.data.blog_id, target.id, parsed.data.role, locals.user.id);
	await audit(event, {
		event: isRoleChange ? 'blog.member_role_changed' : 'blog.member_added',
		actorUserId: locals.user.id,
		subjectUserId: target.id,
		subjectBlogId: parsed.data.blog_id,
		metadata: {
			role: parsed.data.role,
			previous_role: existing?.role ?? null
		}
	});
	return json({
		ok: true,
		member: {
			user_id: target.id,
			username: target.username,
			role: parsed.data.role
		}
	});
};

export const DELETE: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = RemoveBody.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	await requireRole(parsed.data.blog_id, locals.user.id, ROLES_MANAGING);
	if (parsed.data.target_user_id === locals.user.id) throw error(409, "you can't remove yourself");
	const existing = await getActiveMember(parsed.data.blog_id, parsed.data.target_user_id);
	await removeMember(parsed.data.blog_id, parsed.data.target_user_id);
	if (existing) {
		await audit(event, {
			event: 'blog.member_removed',
			actorUserId: locals.user.id,
			subjectUserId: parsed.data.target_user_id,
			subjectBlogId: parsed.data.blog_id,
			metadata: { previous_role: existing.role }
		});
	}
	return json({ ok: true });
};

// Capability toggle (Phase 6 permissions dashboard). PATCH a member's capability
// booleans. can_admin-gated (replaces the owner-only ROLES_MANAGING). Writes BOTH
// the internal audit_log AND the member-visible permission_changes log. The
// last-admin guard (in changeCapabilities) blocks removing the final admin.
const PatchBody = z.object({
	blog_id: z.string().uuid(),
	target: z.object({ username: z.string() }),
	caps: z
		.object({
			author: z.boolean().optional(),
			review: z.boolean().optional(),
			comment: z.boolean().optional(),
			admin: z.boolean().optional()
		})
		.refine((c) => Object.keys(c).length > 0, 'at least one capability must be set')
});

export const PATCH: RequestHandler = async (event) => {
	const { request, locals } = event;
	if (!locals.user) throw error(401, 'sign in required');
	const parsed = PatchBody.safeParse(await request.json());
	if (!parsed.success) throw error(422, parsed.error.message);

	// Only a blog admin (can_admin) may change capabilities.
	await requireCapability(parsed.data.blog_id, locals.user.id, 'admin');

	const target = await getUserByUsername(parsed.data.target.username);
	if (!target) throw error(404, 'target user not found');
	// Keep the existing self-guard: an admin can't change their own permissions
	// (avoids self-lockout races; the last-admin guard is a backstop).
	if (target.id === locals.user.id) throw error(409, "you can't change your own permissions");

	const { before, after } = await changeCapabilities({
		blogId: parsed.data.blog_id,
		targetUserId: target.id,
		actorUserId: locals.user.id,
		patch: parsed.data.caps
	});

	// Internal operator audit (attributed, with IP/UA — NOT anonymous).
	await audit(event, {
		event: 'blog.member_role_changed',
		actorUserId: locals.user.id,
		subjectUserId: target.id,
		subjectBlogId: parsed.data.blog_id,
		metadata: { old_caps: before, new_caps: after, kind: 'capabilities' }
	});

	// Return the short-key capability shape the client grid uses.
	return json({
		ok: true,
		caps: {
			author: after.canAuthor,
			review: after.canReview,
			comment: after.canComment,
			admin: after.canAdmin
		}
	});
};
