import { error, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import type { MemberRole, Capability, User } from '$lib/db/schema';
import { hasCapability as hasCapabilityDb } from '$lib/db/members';
import { isFreedinkOperator } from '$lib/server/operators';

export function requireUser(locals: App.Locals): User {
	if (!locals.user) throw redirect(303, '/signup');
	return locals.user;
}

// ─────────────── FreedInk service-operator cross-blog bypass ───────────────
//
// A FreedInk operator (FREEDINK_OPERATOR_SUBS) is a cross-blog superuser for the
// ADMIN surface: managing members/roles, editing settings, moderating posts and
// comments, and viewing the review queue on ANY blog, without holding a
// membership row. The bypass is deliberately scoped:
//   • role gates (hasRole/requireRole) — operator passes every set (Manage,
//     Settings, Review-view, moderation). Content-write role checks
//     (ROLES_WRITING) are also passed, but a write still needs a valid Semaphore
//     proof the operator can only make if their identity is in the tree, so this
//     grants no anonymous-authorship shortcut.
//   • capability gates — operator only bypasses the `admin` capability. It does
//     NOT bypass `review` (blind-token vote-token issuance) so the operator can
//     view a queue without being able to silently pad a tally, preserving the
//     unlinkable-vote invariant, nor `author`/`comment` (Semaphore trees).

export async function requireRole(
	blogId: string,
	userId: string,
	roles: readonly MemberRole[]
): Promise<MemberRole> {
	const rows = await db
		.select({ role: schema.blogMembers.role })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt),
				inArray(schema.blogMembers.role, roles as MemberRole[])
			)
		);
	if (rows.length > 0) return rows[0].role;
	// Cross-blog operator: no membership row, effective role is owner-equivalent.
	if (await isFreedinkOperator(userId)) return 'owner';
	throw error(403, 'forbidden');
}

export async function hasRole(
	blogId: string,
	userId: string,
	roles: readonly MemberRole[]
): Promise<boolean> {
	const rows = await db
		.select({ id: schema.blogMembers.id })
		.from(schema.blogMembers)
		.where(
			and(
				eq(schema.blogMembers.blogId, blogId),
				eq(schema.blogMembers.userId, userId),
				isNull(schema.blogMembers.removedAt),
				inArray(schema.blogMembers.role, roles as MemberRole[])
			)
		)
		.limit(1);
	if (rows.length > 0) return true;
	return isFreedinkOperator(userId);
}

export const ROLES_PROVING: readonly MemberRole[] = ['owner', 'editor', 'reviewer', 'author'];
export const ROLES_MANAGING: readonly MemberRole[] = ['owner'];
export const ROLES_REVIEWING: readonly MemberRole[] = ['owner', 'editor', 'reviewer'];
export const ROLES_WRITING: readonly MemberRole[] = ['owner', 'editor', 'author'];
export const ROLES_COMMENTING: readonly MemberRole[] = [
	'owner',
	'editor',
	'reviewer',
	'author',
	'commenter'
];

// ─────────────── capability-based authorization (compat shim) ───────────────
//
// The legacy ROLES_* sets map onto capability reads as follows. Each set is the
// union of roles that hold the corresponding capability under the 0007 backfill,
// so a capability read is exactly equivalent to the old `inArray(role, SET)`:
//   ROLES_WRITING   ≡ can_author   (owner/editor/author)
//   ROLES_REVIEWING ≡ can_review   (owner/editor/reviewer)
//   ROLES_COMMENTING≡ can_comment  (everyone)
//   ROLES_MANAGING  ≡ can_admin    (owner)
//   ROLES_PROVING   ≡ can_author OR can_review (the old mixed proving set)
// Callers should migrate to these. requireRole/hasRole still work (role is kept
// in lockstep) but they cannot express a single capability cleanly.

// The capability a given ROLES_* helper is equivalent to. ROLES_PROVING has no
// single-capability equivalent (it is author ∪ review) and is intentionally
// absent — it is only used by the legacy single mixed tree, which Phase 2
// replaces with per-capability trees.
export const CAPABILITY_FOR_ROLES = new Map<readonly MemberRole[], Capability>([
	[ROLES_WRITING, 'author'],
	[ROLES_REVIEWING, 'review'],
	[ROLES_COMMENTING, 'comment'],
	[ROLES_MANAGING, 'admin']
]);

// Read a capability on a blog, with the operator bypass applied to `admin` only.
// Membership is checked first (cheap single-row read); the operator lookup is a
// fallback so normal members never pay for it.
export async function hasCapability(
	blogId: string,
	userId: string,
	capability: Capability
): Promise<boolean> {
	if (await hasCapabilityDb(blogId, userId, capability)) return true;
	// Operator superuser bypasses ONLY the admin capability. review/author/comment
	// are proving/voting gates the operator has no legitimate standing to bypass.
	if (capability === 'admin') return isFreedinkOperator(userId);
	return false;
}

// Throw 403 unless the user holds `capability` on the blog. The capability
// equivalent of requireRole, reading the boolean column rather than the enum.
export async function requireCapability(
	blogId: string,
	userId: string,
	capability: Capability
): Promise<void> {
	if (!(await hasCapability(blogId, userId, capability))) throw error(403, 'forbidden');
}
