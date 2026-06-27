import { error, redirect } from '@sveltejs/kit';
import { db, schema } from '$lib/db/client';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import type { MemberRole, Capability, User } from '$lib/db/schema';
import { hasCapability } from '$lib/db/members';

export function requireUser(locals: App.Locals): User {
	if (!locals.user) throw redirect(303, '/signup');
	return locals.user;
}

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
	if (rows.length === 0) throw error(403, 'forbidden');
	return rows[0].role;
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
	return rows.length > 0;
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

// Throw 403 unless the user holds `capability` on the blog. The capability
// equivalent of requireRole, reading the boolean column rather than the enum.
export async function requireCapability(
	blogId: string,
	userId: string,
	capability: Capability
): Promise<void> {
	if (!(await hasCapability(blogId, userId, capability))) throw error(403, 'forbidden');
}

// Re-export so callers can `import { hasCapability } from '$lib/server/auth'`
// alongside requireCapability without reaching into $lib/db.
export { hasCapability };
